import "server-only";

import { removeRosterEntry, requireManualLeague, setRosterEntry } from "@/lib/leagues/manual";
import type { Db } from "@/lib/supabase/db";

import { kindFor, validateMove, type MoveItem, type MoveKind } from "./moves";

/**
 * Recording a move, and applying it.
 *
 * Both, in that order, in one call. The alternative — a ledger the user writes
 * separately from the rosters it describes — is two sources of truth for the
 * same fact, and they diverge the first time someone records a trade and
 * forgets to move the players. `rosters` stays the answer to "who has him
 * now"; `transactions` is the record of how that came to be true.
 */

export type MoveInput = {
  items: MoveItem[];
  /** The league week the move happened in, when the manager knows it. */
  week: number | null;
  faabBid: number | null;
  note: string | null;
  /** Defaults to now — a move recorded late still happened when it happened. */
  occurredAt: string | null;
};

export type RecordedMove = { id: string; kind: MoveKind };

/**
 * Applies a move to the rosters, then writes it to the ledger.
 *
 * Rosters first, on purpose. Postgres has no transaction to hold across
 * PostgREST calls, so one of the two writes has to go first and one of the two
 * failure modes has to be the one that happens. A roster change with no ledger
 * entry is a league that is *correct* and under-documented; a ledger entry
 * with no roster change is a league that is *wrong* and looks documented. The
 * second is much worse, so the ledger goes last and the caller is told when it
 * is the half that failed.
 */
export async function recordMove(
  db: Db,
  leagueId: string,
  input: MoveInput,
): Promise<RecordedMove> {
  await requireManualLeague(db, leagueId);

  const problem = validateMove(input.items);
  if (problem) throw new Error(problem);

  const kind = kindFor(input.items);
  if (!kind) throw new Error("Nothing about this move changes a roster.");

  for (const item of input.items) {
    if (item.toTeamId !== null) {
      // Slot is left to the roster editor. A player arriving mid-week lands on
      // the bench, which is both the safe answer and the true one until
      // someone sets a lineup.
      await setRosterEntry(db, leagueId, item.toTeamId, item.playerId, "BN");
    } else if (item.fromTeamId !== null) {
      await removeRosterEntry(db, leagueId, item.fromTeamId, item.playerId);
    }
  }

  const { data: transaction, error } = await db
    .from("transactions")
    .insert({
      league_id: leagueId,
      kind,
      week: input.week,
      faab_bid: input.faabBid,
      note: input.note,
      ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
    })
    .select("id")
    .single();

  if (error || !transaction) {
    throw new Error(
      `The rosters were updated, but the move could not be logged: ${error?.message}`,
    );
  }

  const { error: itemsError } = await db.from("transaction_items").insert(
    input.items.map((item) => ({
      transaction_id: transaction.id,
      player_id: item.playerId,
      from_team_id: item.fromTeamId,
      to_team_id: item.toTeamId,
    })),
  );

  if (itemsError) {
    // A header with no legs describes nothing. Take it back out rather than
    // leave a blank row in the history.
    await db.from("transactions").delete().eq("id", transaction.id);
    throw new Error(
      `The rosters were updated, but the move could not be logged: ${itemsError.message}`,
    );
  }

  return { id: transaction.id, kind };
}

// ---------------------------------------------------------------------------
// reading the ledger
// ---------------------------------------------------------------------------

export type MoveEntry = {
  playerId: number;
  playerName: string;
  position: string | null;
  nflTeam: string | null;
  fromTeam: string | null;
  toTeam: string | null;
};

export type MoveRecord = {
  id: string;
  kind: MoveKind;
  occurredAt: string;
  week: number | null;
  faabBid: number | null;
  note: string | null;
  entries: MoveEntry[];
};

/** A season of moves is a few hundred rows; a screen of them is this many. */
const HISTORY_LIMIT = 100;

export async function loadMoves(
  db: Db,
  leagueId: string,
  limit = HISTORY_LIMIT,
): Promise<MoveRecord[]> {
  const { data, error } = await db
    .from("transactions")
    .select(
      `id, kind, occurred_at, week, faab_bid, note,
       transaction_items (
         player_id,
         players ( full_name, position, nfl_team ),
         from_team:teams!transaction_items_from_team_id_fkey ( name ),
         to_team:teams!transaction_items_to_team_id_fkey ( name )
       )`,
    )
    .eq("league_id", leagueId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not read the move history: ${error.message}`);

  type Joined = {
    id: string;
    kind: string;
    occurred_at: string;
    week: number | null;
    faab_bid: number | null;
    note: string | null;
    transaction_items: {
      player_id: number;
      players: {
        full_name: string;
        position: string | null;
        nfl_team: string | null;
      } | null;
      from_team: { name: string } | null;
      to_team: { name: string } | null;
    }[];
  };

  return (data as unknown as Joined[])
    // A transaction whose every leg named a team that has since been deleted
    // has had its items cascade away with it, and an entry describing no
    // players is not history — it is a blank row asking to be puzzled over.
    .filter((row) => row.transaction_items.length > 0)
    .map((row) => ({
      id: row.id,
      kind: row.kind as MoveKind,
      occurredAt: row.occurred_at,
      week: row.week,
      faabBid: row.faab_bid,
      note: row.note,
      entries: row.transaction_items.map((item) => ({
        playerId: item.player_id,
        // A player deleted from the master list still had a move made for him.
        // The history is a record of what happened, so the row survives its
        // subject rather than vanishing with him.
        playerName: item.players?.full_name ?? `Player ${item.player_id}`,
        position: item.players?.position ?? null,
        nflTeam: item.players?.nfl_team ?? null,
        fromTeam: item.from_team?.name ?? null,
        toTeam: item.to_team?.name ?? null,
      })),
    }));
}

/**
 * Removes a move from the history.
 *
 * The ledger only. Rosters are deliberately left alone: a move recorded three
 * weeks ago has been built on since, and silently reversing it would undo
 * every later move that depended on it. Deleting is for a move that was typed
 * wrong, and the roster it should have produced is fixed on the roster screen.
 */
export async function deleteMove(
  db: Db,
  leagueId: string,
  transactionId: string,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  const { error } = await db
    .from("transactions")
    .delete()
    .eq("id", transactionId)
    .eq("league_id", leagueId);

  if (error) throw new Error(`Could not remove the move: ${error.message}`);
}

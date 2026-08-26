import "server-only";

import { loadNeedWeights } from "@/lib/needs/store";
import type { RosterSlot } from "@/lib/sources/yahoo";
import type { Db } from "@/lib/supabase/db";
import { isValueSource, type ValueSource } from "@/lib/values/engine";
import type { StartingSlot } from "@/lib/values/vor";

import { DEFAULT_TRADE_PARAMS, PARAM_LIMITS, type TradeParams, type VerdictBand } from "./analyze";
import { parseSnapshot, type TradeSnapshot } from "./saved";

/**
 * The analyzer's persistence and its one read (§6, §8).
 *
 * The math lives next door in `analyze.ts` and never touches this file — §2
 * requires it to run in the browser on every keystroke, so everything here
 * happens exactly twice: once when the page loads the board, and once when the
 * user saves what they built.
 *
 * Takes a `Db` rather than making one, like every other data-access module.
 */

/** One tradeable player, as the analyzer sees them. */
export type TradeBoardAsset = {
  playerId: number;
  name: string;
  position: string | null;
  nflTeam: string | null;
  injuryStatus: string | null;
  /** Yahoo's reason for the status ("Knee"); null when Yahoo gave none. */
  injuryNote: string | null;
  /** Sleeper's portrait, already resolved on the player master. */
  headshotUrl: string | null;
  value: number;
  source: ValueSource;
  teamId: string;
  slot: string | null;
  isStarter: boolean;
  projectedPoints: number | null;
  /** §5's rest-of-season points — what §6's roster-context delta is measured in. */
  rosPoints: number | null;
};

export type TradeBoardTeam = {
  id: string;
  name: string;
  managerName: string | null;
  isUsersTeam: boolean;
  /** §7's `need` by position, so the delta panel can say what a deal fixes. */
  needs: Record<string, number>;
  /**
   * §7's `surplusZ` by position. Nothing on the trade page reads it; Phase 8's
   * suggestion engines do, and they run over exactly this board. Carrying it
   * here rather than fetching it again is the same argument the needs vector
   * itself makes — it comes off the row already being read.
   */
  surplusZ: Record<string, number>;
};

export type TradeBoard = {
  teams: TradeBoardTeam[];
  assets: TradeBoardAsset[];
  params: TradeParams;
  /** The league's own starting slots — the lineup delta is solved against them. */
  rosterSlots: StartingSlot[];
  computedAt: string | null;
  /** §4: rostered players the crosswalk could not resolve are missing from the board. */
  unresolved: number;
};

export type SavedTradeRecord = {
  id: string;
  verdict: VerdictBand;
  note: string | null;
  createdAt: string;
  snapshot: TradeSnapshot;
};

function clampParam(key: keyof TradeParams, value: number): number {
  const { min, max } = PARAM_LIMITS[key];
  if (!Number.isFinite(value)) return DEFAULT_TRADE_PARAMS[key];
  return Math.min(max, Math.max(min, value));
}

/** The three knobs, clamped to the ranges the sliders and the check constraints share. */
export function normalizeParams(input: Partial<TradeParams>): TradeParams {
  return {
    alpha: clampParam("alpha", input.alpha ?? DEFAULT_TRADE_PARAMS.alpha),
    beta: clampParam("beta", input.beta ?? DEFAULT_TRADE_PARAMS.beta),
    gamma: clampParam("gamma", input.gamma ?? DEFAULT_TRADE_PARAMS.gamma),
  };
}

/**
 * A league with no settings row is a league on §6's defaults, not an error —
 * the row is written the first time someone moves a slider. Postgres numerics
 * come back as strings often enough that they are re-cast here rather than
 * trusted.
 */
export async function loadTradeParams(
  db: Db,
  leagueId: string,
): Promise<TradeParams> {
  const { data } = await db
    .from("league_settings")
    .select("alpha, beta, gamma")
    .eq("league_id", leagueId)
    .maybeSingle();

  if (!data) return DEFAULT_TRADE_PARAMS;

  return normalizeParams({
    alpha: Number(data.alpha),
    beta: Number(data.beta),
    gamma: Number(data.gamma),
  });
}

export async function saveTradeParams(
  db: Db,
  leagueId: string,
  params: Partial<TradeParams>,
): Promise<TradeParams> {
  const next = normalizeParams(params);

  const { error } = await db
    .from("league_settings")
    .upsert({ league_id: leagueId, ...next }, { onConflict: "league_id" });

  if (error) throw new Error(`Could not save the tuning: ${error.message}`);
  return next;
}

/**
 * Everything the analyzer needs, in one read, so the browser can price a trade
 * without going back to the server.
 *
 * Rostered players only. Free agents are not tradeable, and the waiver wire is
 * Requirement 7's question — asked and answered on projections rather than
 * values (§7), on its own screen.
 *
 * The league's starting slots and the §7 needs vector ride along because §6's
 * roster-context delta is a *second* scorer over the same two packages: it runs
 * in the browser next to `analyzeTrade`, so everything it reads has to arrive
 * in the same trip.
 */
export async function loadTradeBoard(
  db: Db,
  leagueId: string,
): Promise<TradeBoard> {
  const [
    { data: league, error: leagueError },
    { data: teams, error: teamError },
    { data: rows, error },
    params,
    { count: unresolved },
  ] = await Promise.all([
    db.from("leagues").select("roster_slots").eq("id", leagueId).single(),
    db
      .from("teams")
      .select("id, name, manager_name, is_users_team")
      .eq("league_id", leagueId)
      .order("is_users_team", { ascending: false })
      .order("name"),
    db
      .from("league_player_values")
      .select(
        "player_id, full_name, position, nfl_team, injury_status, injury_note, headshot_url, value, value_source, team_id, slot, is_starter, projected_pts_ppr, ros_points, computed_at",
      )
      .eq("league_id", leagueId)
      .not("team_id", "is", null)
      .order("value", { ascending: false }),
    loadTradeParams(db, leagueId),
    db
      .from("unmatched_players")
      .select("id", { count: "exact", head: true })
      .eq("league_id", leagueId)
      .is("resolved_at", null),
  ]);

  if (leagueError || !league) {
    throw new Error(`League not found: ${leagueError?.message ?? leagueId}`);
  }
  if (teamError) throw new Error(`Failed to read teams: ${teamError.message}`);
  if (error) throw new Error(`Failed to read values: ${error.message}`);

  const needs = await loadNeedWeights(
    db,
    (teams ?? []).map((team) => team.id),
  );

  let computedAt: string | null = null;
  const assets: TradeBoardAsset[] = [];

  for (const row of rows ?? []) {
    // The view's `team_id` is nullable because free agents share it; the query
    // above has already excluded them, and this narrows the type honestly.
    if (!row.team_id) continue;

    if (computedAt === null || row.computed_at > computedAt) {
      computedAt = row.computed_at;
    }

    assets.push({
      playerId: row.player_id,
      name: row.full_name,
      position: row.position,
      nflTeam: row.nfl_team,
      injuryStatus: row.injury_status,
      injuryNote: row.injury_note,
      headshotUrl: row.headshot_url,
      value: row.value,
      // A source the enum does not know is a value we cannot vouch for, so it
      // is treated as unvalued — which refuses a verdict rather than quietly
      // summing it (§4).
      source: isValueSource(row.value_source) ? row.value_source : "floor",
      teamId: row.team_id,
      slot: row.slot,
      isStarter: row.is_starter ?? false,
      projectedPoints:
        row.projected_pts_ppr === null ? null : Number(row.projected_pts_ppr),
      rosPoints: row.ros_points === null ? null : Number(row.ros_points),
    });
  }

  return {
    teams: (teams ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      managerName: team.manager_name,
      isUsersTeam: team.is_users_team,
      needs: needs.get(team.id)?.need ?? {},
      surplusZ: needs.get(team.id)?.surplusZ ?? {},
    })),
    assets,
    params,
    rosterSlots: league.roster_slots as unknown as RosterSlot[],
    computedAt,
    unresolved: unresolved ?? 0,
  };
}

const SAVED_LIMIT = 25;

export async function loadSavedTrades(
  db: Db,
  leagueId: string,
): Promise<SavedTradeRecord[]> {
  const { data, error } = await db
    .from("saved_trades")
    .select("id, verdict, note, payload, created_at")
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false })
    .limit(SAVED_LIMIT);

  if (error) throw new Error(`Failed to read saved trades: ${error.message}`);

  const records: SavedTradeRecord[] = [];

  for (const row of data ?? []) {
    const snapshot = parseSnapshot(row.payload);
    // A payload written by a shape this build cannot read is skipped rather
    // than rendered half-way. It stays in the table; a later version may know
    // what to do with it.
    if (!snapshot) continue;

    records.push({
      id: row.id,
      verdict: snapshot.band,
      note: row.note,
      createdAt: row.created_at,
      snapshot,
    });
  }

  return records;
}

export async function saveTrade(
  db: Db,
  {
    userId,
    leagueId,
    snapshot,
    note,
  }: {
    userId: string;
    leagueId: string;
    snapshot: TradeSnapshot;
    note: string | null;
  },
): Promise<string> {
  const { data, error } = await db
    .from("saved_trades")
    .insert({
      user_id: userId,
      league_id: leagueId,
      // The band comes off the snapshot rather than from the caller, so the
      // filterable column and the payload can never disagree.
      verdict: snapshot.band,
      note: note?.trim() ? note.trim() : null,
      payload: snapshot,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not save the trade: ${error.message}`);
  return data.id;
}

/** RLS scopes the delete to the owner; the filter is here so a miss is visible. */
export async function deleteSavedTrade(
  db: Db,
  leagueId: string,
  tradeId: string,
): Promise<void> {
  const { error } = await db
    .from("saved_trades")
    .delete()
    .eq("id", tradeId)
    .eq("league_id", leagueId);

  if (error) throw new Error(`Could not delete the trade: ${error.message}`);
}

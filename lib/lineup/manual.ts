import "server-only";

import { requireManualLeague, teamIdsOf } from "@/lib/leagues/manual";
import { scoredPoints, type StatLine } from "@/lib/sources/sleeper-parse";
import type { RosterSlot } from "@/lib/sources/yahoo-parse";
import type { Db } from "@/lib/supabase/db";
import type { StartingSlot } from "@/lib/values/vor";

import { BENCH, bestAssignment, seatMoves, type Seatable } from "./assign";
import { resolveWeek } from "./store";

/**
 * Setting a hand-kept league's lineup.
 *
 * Manual only, for the reason every other manual writer here is manual only:
 * sync stage 7 overwrites `is_starter` wholesale for an imported league, so a
 * lineup set here would disappear at the next sync without saying anything.
 * An imported league's lineup belongs to its provider and is read, never
 * written.
 *
 * Nothing here calls `markLeagueDirty`, and nothing needs to. `rosters` has a
 * `before update` trigger on `updated_at`, so a seating change is already
 * visible to `rostersMovedSince` and the next page load starts a run. Worth
 * knowing that it *does* — a lineup change moves no value and no needs vector,
 * since `bestLineup` solves from scratch and has never read `is_starter`, so
 * the run it triggers has nothing to find.
 */

/**
 * What both writers need to know about the league, read once from the row
 * rather than passed in from a form.
 *
 * The starting slots especially. They are the league's own settings and the
 * shape of every legal lineup in it, and a browser is not a place to keep
 * either — a posted slot list is a posted claim about what the league allows.
 */
export type LineupContext = {
  season: number;
  ppr: number;
  slots: StartingSlot[];
  /** The week a lineup is chosen for: the live one, or the league's first. */
  week: number;
};

export async function loadLineupContext(
  db: Db,
  leagueId: string,
): Promise<LineupContext> {
  const { data, error } = await db
    .from("leagues")
    .select("season, ppr, roster_slots, current_week, start_week, end_week")
    .eq("id", leagueId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the league: ${error.message}`);
  if (!data) throw new Error("That league does not exist.");

  return {
    season: data.season,
    ppr: Number(data.ppr),
    slots: (data.roster_slots ?? []) as unknown as RosterSlot[],
    week: resolveWeek(
      {
        currentWeek: data.current_week,
        startWeek: data.start_week,
        endWeek: data.end_week,
      },
      undefined,
    ),
  };
}

/** What a lineup is solved against, and what the board says it solved against. */
export type LineupBasis = "week" | "season";

export type LineupPlayerRow = Seatable & {
  name: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  /** What the solve ranked him on, in the units `basis` names. */
  points: number | null;
};

export type LineupRoster = {
  players: LineupPlayerRow[];
  basis: LineupBasis;
  /** The week `basis: "week"` refers to. Null when the solve fell back. */
  week: number | null;
};

/**
 * One team's roster, priced for a lineup decision.
 *
 * Two metrics, and only ever one of them at a time. This week's projection is
 * what a lineup is actually chosen on, so it leads; rest-of-season points are
 * the fallback for a week the grid has never covered — the preseason, or a
 * league whose season has not started. Mixing them inside one solve would be
 * meaningless arithmetic: 14 projected points this Sunday and 180 across the
 * rest of the year are not numbers that can be compared, and a lineup built by
 * comparing them would be nonsense presented as advice.
 */
export async function loadLineupRoster(
  db: Db,
  {
    leagueId,
    teamId,
    season,
    week,
    ppr,
  }: {
    leagueId: string;
    teamId: string;
    season: number;
    week: number | null;
    ppr: number;
  },
): Promise<LineupRoster> {
  const { data, error } = await db
    .from("rosters")
    .select(
      "player_id, slot, players (full_name, position, nfl_team, injury_status)",
    )
    .eq("team_id", teamId);

  if (error) throw new Error(`Could not read the roster: ${error.message}`);

  type Joined = {
    player_id: number;
    slot: string | null;
    players: {
      full_name: string;
      position: string | null;
      nfl_team: string | null;
      injury_status: string | null;
    } | null;
  };

  const rows = (data ?? []) as unknown as Joined[];
  const playerIds = rows.map((row) => row.player_id);

  const weekly =
    week === null
      ? new Map<number, number | null>()
      : await readWeeklyProjections(db, { season, week, playerIds, ppr });

  // "Has this week been covered for this roster" rather than "does the table
  // have any row at all": a grid pulled for a season this league does not play
  // would otherwise seat one man and bench fourteen.
  const basis: LineupBasis = weekly.size > 0 ? "week" : "season";
  const seasonPoints =
    basis === "season"
      ? await readSeasonPoints(db, { leagueId, playerIds })
      : new Map<number, number | null>();

  const players: LineupPlayerRow[] = rows.map((row) => ({
    playerId: row.player_id,
    name: row.players?.full_name ?? `Player ${row.player_id}`,
    position: row.players?.position ?? null,
    nflTeam: row.players?.nfl_team ?? null,
    injuryStatus: row.players?.injury_status ?? null,
    slot: row.slot,
    points:
      (basis === "week" ? weekly.get(row.player_id) : seasonPoints.get(row.player_id)) ??
      null,
  }));

  return {
    players,
    basis,
    week: basis === "week" ? week : null,
  };
}

/**
 * One week of the projection grid, scored for this league.
 *
 * Re-scored on read from the raw stat line rather than trusted from the stored
 * `pts_ppr`, for §1.2's reason and exactly as `lib/lineup/store.ts` does it:
 * one row is shared by every league in the app and the league's own PPR
 * modifier decides what it is worth.
 */
async function readWeeklyProjections(
  db: Db,
  {
    season,
    week,
    playerIds,
    ppr,
  }: { season: number; week: number; playerIds: number[]; ppr: number },
): Promise<Map<number, number | null>> {
  const lines = new Map<number, number | null>();
  if (playerIds.length === 0) return lines;

  const { data, error } = await db
    .from("player_projections")
    .select("player_id, stats, pts_ppr")
    .eq("season", season)
    .eq("week", week)
    .in("player_id", playerIds);

  if (error) return lines;

  for (const row of data ?? []) {
    const line: StatLine = {
      sleeperId: "",
      ptsPpr: row.pts_ppr,
      stats: (row.stats ?? {}) as Record<string, number>,
    };
    lines.set(row.player_id, scoredPoints(line, ppr));
  }

  return lines;
}

/** Rest-of-season points, as §5's engine priced them for this league. */
async function readSeasonPoints(
  db: Db,
  { leagueId, playerIds }: { leagueId: string; playerIds: number[] },
): Promise<Map<number, number | null>> {
  const points = new Map<number, number | null>();
  if (playerIds.length === 0) return points;

  const { data, error } = await db
    .from("player_values")
    .select("player_id, ros_points")
    .eq("league_id", leagueId)
    .in("player_id", playerIds);

  if (error) return points;

  for (const row of data ?? []) points.set(row.player_id, row.ros_points);
  return points;
}

/** Writes a set of slot changes, and nothing else about the roster rows. */
async function writeSlots(
  db: Db,
  teamId: string,
  moves: { playerId: number; slot: string }[],
): Promise<number> {
  if (moves.length === 0) return 0;

  const stamped = new Date().toISOString();

  const { error } = await db.from("rosters").upsert(
    moves.map((move) => ({
      team_id: teamId,
      player_id: move.playerId,
      slot: move.slot,
      // The one invariant this write carries: a starter is a man in a starting
      // seat. `setRosterEntry` says the same thing the same way.
      is_starter: move.slot !== BENCH && move.slot !== "IR",
      updated_at: stamped,
    })),
    { onConflict: "team_id,player_id" },
  );

  if (error) throw new Error(`Could not save the lineup: ${error.message}`);
  return moves.length;
}

async function requireTeam(db: Db, leagueId: string, teamId: string) {
  await requireManualLeague(db, leagueId);
  const teamIds = await teamIdsOf(db, leagueId);
  if (!teamIds.includes(teamId)) {
    throw new Error("That team is not in this league.");
  }
}

/**
 * Seats the best lineup this roster can field.
 *
 * The whole roster is rewritten rather than only the seats that changed, and
 * that is the point rather than an inefficiency: a lineup is optimal only if
 * everybody who is not in it is on the bench, and an update that seats three
 * men without clearing the two they displaced leaves a roster with more
 * starters than the league has seats.
 */
export async function applyBestLineup(
  db: Db,
  { leagueId, teamId }: { leagueId: string; teamId: string },
): Promise<{ seated: number; basis: LineupBasis }> {
  await requireTeam(db, leagueId, teamId);

  const context = await loadLineupContext(db, leagueId);
  const roster = await loadLineupRoster(db, { leagueId, teamId, ...context });
  const assignment = bestAssignment(roster.players, context.slots);

  const moves = [...assignment].map(([playerId, slot]) => ({ playerId, slot }));
  await writeSlots(db, teamId, moves);

  return {
    seated: moves.filter((move) => move.slot !== BENCH).length,
    basis: roster.basis,
  };
}

/**
 * Puts one player in one seat, and moves whoever was there.
 *
 * Deliberately not `setRosterEntry`: that function's job is ownership — it is
 * the only writer of "one owner per player, per league" and it clears every
 * other roster in the league on the way past. Nothing here changes who owns
 * anybody. Both men are already on this roster, and all that moves is which
 * seat each is in.
 */
export async function seatPlayer(
  db: Db,
  {
    leagueId,
    teamId,
    slot,
    incomingId,
    outgoingId,
  }: {
    leagueId: string;
    teamId: string;
    slot: string;
    incomingId: number | null;
    outgoingId: number | null;
  },
): Promise<void> {
  await requireTeam(db, leagueId, teamId);

  const context = await loadLineupContext(db, leagueId);

  // The seat has to be one the league actually has. Without this, a posted
  // slot name would let anybody invent a seat and park a player in it, and
  // every screen that totals starters would count him.
  const legal = context.slots.some(
    (entry) =>
      entry.isStarting &&
      entry.count > 0 &&
      entry.position.trim().toUpperCase() === slot.trim().toUpperCase(),
  );

  if (!legal) throw new Error("This league has no such starting slot.");

  const roster = await loadLineupRoster(db, { leagueId, teamId, ...context });
  await writeSlots(db, teamId, seatMoves(roster.players, slot, incomingId, outgoingId));
}

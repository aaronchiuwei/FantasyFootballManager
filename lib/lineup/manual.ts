import "server-only";

import { requireManualLeague, teamIdsOf } from "@/lib/leagues/manual";
import { scoredPoints, type StatLine } from "@/lib/sources/sleeper-parse";
import type { RosterSlot } from "@/lib/sources/yahoo-parse";
import type { Db } from "@/lib/supabase/db";
import type { StartingSlot } from "@/lib/values/vor";

import {
  BENCH,
  bestAssignment,
  isReserveSlot,
  resolveLineup,
  seatMoves,
  type Seatable,
} from "./assign";
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
 * Written to `lineups`, keyed by week, and never to `rosters`. A lineup is a
 * decision about a week; `rosters.slot` answers a question about ownership and
 * about what the provider last said, which is not the same question and cannot
 * hold two weeks' answers at once.
 *
 * Nothing here marks the league for recomputation, and nothing should. A
 * lineup moves no value and no needs vector — `bestLineup` solves from scratch
 * and has never read a stored slot — so a run triggered by one would have
 * nothing to find. Writing to its own table rather than to `rosters` is also
 * what keeps the auto-sync's dirty check from firing on every seat change.
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
  /** The week this lineup is for, clamped to one the league actually plays. */
  week: number;
};

/**
 * `week` is passed in and then checked against the league's own window rather
 * than trusted: a lineup for a week the league does not play is a row nothing
 * will ever read, and `resolveWeek` already knows which weeks those are.
 */
export async function loadLineupContext(
  db: Db,
  leagueId: string,
  week: number,
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
      week,
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
  /**
   * The week's lineup as stored, which is empty until somebody sets one. Kept
   * separate from the players so a caller can tell "nobody has set this week"
   * from "this week is set and he is benched".
   */
  stored: Map<number, string>;
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
    slots,
  }: {
    leagueId: string;
    teamId: string;
    season: number;
    week: number;
    ppr: number;
    slots: StartingSlot[];
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

  const [weekly, stored] = await Promise.all([
    readWeeklyProjections(db, { season, week, playerIds, ppr }),
    readWeek(db, teamId, week),
  ]);

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
    // The roster's own slot for now. Resolved to the week's seat below, which
    // needs every player's points to have been read first.
    slot: stored.get(row.player_id) ?? row.slot,
    points:
      (basis === "week" ? weekly.get(row.player_id) : seasonPoints.get(row.player_id)) ??
      null,
  }));

  // The same resolution the start/sit board makes, made here too.
  //
  // Not an optimisation — a correctness requirement. `rosters.slot` is what
  // the provider last said or what an older version of this screen wrote, and
  // it is under no obligation to describe a legal lineup: it can hold more men
  // in a slot than the league has seats for, which is how this board came to
  // total more points than the best possible lineup it was sitting next to.
  // An unset week is the best lineup available, and both screens say so.
  const seats = resolveLineup(players, slots, stored);
  for (const player of players) {
    player.slot = seats.get(player.playerId) ?? BENCH;
  }

  return {
    players,
    basis,
    week: basis === "week" ? week : null,
    stored,
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

/**
 * Writes one week's lineup whole: the seated players, and nobody else.
 *
 * Replaced rather than merged, and the delete is the important half. The bench
 * is the absence of a row, so a player who has just been benched is removed —
 * an upsert alone would leave him seated in a lineup that no longer has him,
 * and the resolver would read the week as having two men in one seat.
 */
async function writeWeek(
  db: Db,
  teamId: string,
  week: number,
  assignment: ReadonlyMap<number, string>,
): Promise<number> {
  const seated = [...assignment].filter(
    ([, slot]) => slot !== BENCH && !isReserveSlot(slot),
  );

  const { error: cleared } = await db
    .from("lineups")
    .delete()
    .eq("team_id", teamId)
    .eq("week", week);

  if (cleared) throw new Error(`Could not clear the lineup: ${cleared.message}`);
  if (seated.length === 0) return 0;

  const { error } = await db.from("lineups").insert(
    seated.map(([playerId, slot]) => ({
      team_id: teamId,
      player_id: playerId,
      week,
      slot,
    })),
  );

  if (error) throw new Error(`Could not save the lineup: ${error.message}`);
  return seated.length;
}

/** The week as it stands, which is empty until somebody sets one. */
async function readWeek(
  db: Db,
  teamId: string,
  week: number,
): Promise<Map<number, string>> {
  const { data, error } = await db
    .from("lineups")
    .select("player_id, slot")
    .eq("team_id", teamId)
    .eq("week", week);

  if (error) throw new Error(`Could not read the lineup: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.player_id, row.slot]));
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
  {
    leagueId,
    teamId,
    week,
  }: { leagueId: string; teamId: string; week: number },
): Promise<{ seated: number; basis: LineupBasis }> {
  await requireTeam(db, leagueId, teamId);

  const context = await loadLineupContext(db, leagueId, week);
  const roster = await loadLineupRoster(db, { leagueId, teamId, ...context });
  const assignment = bestAssignment(roster.players, context.slots);

  return {
    seated: await writeWeek(db, teamId, week, assignment),
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
    week,
    slot,
    incomingId,
    outgoingId,
  }: {
    leagueId: string;
    teamId: string;
    week: number;
    slot: string;
    incomingId: number | null;
    outgoingId: number | null;
  },
): Promise<void> {
  await requireTeam(db, leagueId, teamId);

  const context = await loadLineupContext(db, leagueId, week);

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

  // The whole week is materialised before one seat in it is changed. An unset
  // week is shown as the best lineup, so a manager moving one man off it means
  // "that lineup, but with this change" — writing only the two men who moved
  // would store a two-man lineup and bench the nine they were looking at.
  // Every player already carries his resolved seat, which is what makes this
  // the lineup on screen rather than a second opinion about it.
  const resolved = new Map(
    roster.players.map((player) => [player.playerId, player.slot ?? BENCH]),
  );

  for (const move of seatMoves(roster.players, slot, incomingId, outgoingId)) {
    resolved.set(move.playerId, move.slot);
  }

  await writeWeek(db, teamId, week, resolved);
}

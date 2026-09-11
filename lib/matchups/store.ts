import "server-only";

import {
  loadWeekBoard,
  type WeekBoard,
  type WeekLeague,
  type WeekTeam,
} from "@/lib/lineup/store";
import type { Db } from "@/lib/supabase/db";

import {
  pairings,
  unscheduled,
  type MatchupRow,
  type Pairing,
} from "./board";
import { bySlotOrder } from "./slots";

/**
 * The matchup screen's read: one week of the schedule, over the same rosters
 * the start/sit board already solves.
 *
 * Deliberately built on `loadWeekBoard` rather than beside it. Both screens
 * are the same week of the same league read for a different question, and the
 * moment they read it separately they can disagree — one saying a receiver is
 * projected 14.2 while the other says 13.8 is the kind of thing that costs a
 * user their trust in both numbers. So the roster, projection, stat-line and
 * slate reads happen once, here as there, and this adds exactly one query:
 * the schedule row that says who plays whom.
 *
 * Uncached for the same reason that board is. A win probability that is right
 * as of the last sync is a win probability that is wrong.
 */

/** A team carrying the starting lineup the pairing math reads. */
export type MatchupTeam = WeekTeam & {
  /**
   * `lineup.current.starters`, lifted so the pure builder can see it — and
   * re-sorted into the league's own slot order, which is the order this screen
   * draws them in. The roster's own order is by the player's position, which
   * files a flex running back among the running backs; two lineups read side
   * by side need the seats to line up.
   */
  starters: WeekTeam["lineup"]["current"]["starters"];
};

export type MatchupBoard = {
  season: number;
  week: number;
  /** Every week this league plays, which is the picker's whole range. */
  weeks: number[];
  /** The live NFL week, where the season clock knows one. */
  currentWeek: number | null;
  pairings: Pairing<MatchupTeam>[];
  /** The user's own, lifted out of the list it also appears at the head of. */
  mine: Pairing<MatchupTeam> | null;
  /** Teams this week's schedule does not mention. Normally none. */
  unscheduled: MatchupTeam[];
  /** The same week read as lineups, for the alerts both screens raise. */
  board: WeekBoard;
};

/** One league-week of the schedule. */
async function readSchedule(
  db: Db,
  { leagueId, week }: { leagueId: string; week: number },
): Promise<MatchupRow[]> {
  const { data, error } = await db
    .from("matchups")
    .select(
      "week, team_a, team_b, points_a, points_b, projected_a, projected_b, status, is_playoffs",
    )
    .eq("league_id", leagueId)
    .eq("week", week);

  // A schedule that cannot be read costs the screen its pairings, not its
  // rosters — the same trade every other surface here makes. The page draws
  // "no schedule for this week", which is what an unreadable one looks like
  // from the outside anyway.
  if (error) return [];

  return (data ?? []).map((row) => ({
    week: row.week,
    teamA: row.team_a,
    teamB: row.team_b,
    // Postgres numerics arrive as strings through PostgREST when they are
    // wide enough; every other module here normalises them the same way.
    pointsA: toNumber(row.points_a),
    pointsB: toNumber(row.points_b),
    projectedA: toNumber(row.projected_a),
    projectedB: toNumber(row.projected_b),
    status: row.status,
    isPlayoffs: row.is_playoffs,
  }));
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Two reads: the lineup board for the week, and the week's schedule rows.
 *
 * Takes a `Db` rather than making one, like every other data-access module.
 */
export async function loadMatchupBoard(
  db: Db,
  { league, week }: { league: WeekLeague; week: number },
): Promise<MatchupBoard> {
  const [board, rows] = await Promise.all([
    loadWeekBoard(db, { league, week }),
    readSchedule(db, { leagueId: league.id, week }),
  ]);

  const teams: MatchupTeam[] = board.teams.map((team) => ({
    ...team,
    starters: bySlotOrder(team.lineup.current.starters, league.rosterSlots),
  }));

  const built = pairings(rows, teams, { currentWeek: board.currentWeek });

  return {
    season: board.season,
    week: board.week,
    weeks: board.weeks,
    currentWeek: board.currentWeek,
    pairings: built,
    mine: built.find((pairing) => pairing.involvesUser) ?? null,
    unscheduled: unscheduled(built, teams),
    board,
  };
}

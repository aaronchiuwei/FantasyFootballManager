/**
 * Strength of schedule, as arithmetic over two tables.
 *
 * Pure, so the whole reading can be tested without a database or a live NFL
 * week: the store hands this module the season aggregates and the slate, and
 * everything the UI prints is derived here.
 *
 * The reading has three steps.
 *
 * 1. **Grade every defense.** For one position, take the points per game each
 *    of the 32 defenses allowed it, and standardize across the league. A raw
 *    "22.4 points allowed" is not comparable between running back and tight
 *    end; "0.8 standard deviations softer than the average defense" is.
 * 2. **Walk a team's slate.** For each week in the window, look up the
 *    opponent's grade at that position. A week with no game is a bye, and a
 *    bye is counted and named rather than averaged away.
 * 3. **Rank the 32 slates.** The average opponent grade is a small number by
 *    construction -- seventeen games regress almost anything toward zero -- so
 *    the figure shown is that average converted back into points per game, and
 *    the rank against the other 31 teams is what makes it legible.
 *
 * Every player on an NFL team inherits that team's reading at his position,
 * because that is exactly what strength of schedule is: a fact about the
 * opponents his team is scheduled against, not about him.
 */
import type { GradedPosition } from "@/lib/sources/nflverse-parse";
import { GRADED_POSITIONS } from "@/lib/sources/nflverse-parse";

export type { GradedPosition } from "@/lib/sources/nflverse-parse";
export { GRADED_POSITIONS } from "@/lib/sources/nflverse-parse";

/**
 * How much a finished season counts against a week of the live one.
 *
 * Seventeen prior games at 0.35 are worth about six current ones, so the
 * current season has the majority by roughly Week 6 and the whole of it by the
 * end. The alternative -- a hard switch at some week -- makes the board jump
 * on a Tuesday for no reason a reader could see.
 */
export const PRIOR_SEASON_WEIGHT = 0.35;

/** A row of `nfl_position_scoring`, already scoped to the seasons in play. */
export type ScoringRow = {
  season: number;
  team: string;
  position: string;
  side: "for" | "against";
  games: number;
  pointsStd: number;
  receptions: number;
};

/** A row of `nfl_schedule`. A bye is the absence of one. */
export type ScheduleRow = {
  week: number;
  team: string;
  opponent: string;
  isHome: boolean;
};

export type DefenseGrade = {
  team: string;
  position: GradedPosition;
  /** Points per game allowed to this position, in this league's scoring. */
  ppg: number;
  /** Standard deviations from the 32-team mean. Positive means softer. */
  z: number;
  /** 1 is the softest defense in the league at this position. */
  rank: number;
};

export type PositionScale = { mean: number; sd: number };

export type DefenseBoard = {
  /** Keyed `${team}:${position}`. */
  grades: Map<string, DefenseGrade>;
  scales: Map<GradedPosition, PositionScale>;
  /** Seasons that actually contributed a game, newest first. */
  seasons: number[];
  /** Games of the live season in the blend, per team. Zero before Week 1. */
  liveGames: number;
};

export function gradeKey(team: string, position: string): string {
  return `${team}:${position}`;
}

/** §1.2: a stored total is two pieces, and the league's PPR decides the sum. */
export function scoredPoints(row: ScoringRow, ppr: number): number {
  return row.pointsStd + ppr * row.receptions;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[], average: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
}

/**
 * The 32 defenses graded at each position, blending the live season with the
 * one before it.
 *
 * The blend is a weighted pool of points and games rather than of two rates,
 * so a team that has played once does not get half its grade from that one
 * game: `(live + w * prior) / (liveGames + w * priorGames)`.
 */
export function defenseBoard(
  rows: ScoringRow[],
  {
    season,
    priorSeason,
    ppr,
    priorWeight = PRIOR_SEASON_WEIGHT,
  }: {
    season: number;
    priorSeason: number;
    ppr: number;
    priorWeight?: number;
  },
): DefenseBoard {
  const pooled = new Map<string, { points: number; games: number }>();
  const teams = new Set<string>();
  const seasons = new Set<number>();
  let liveGames = 0;

  for (const row of rows) {
    if (row.side !== "against") continue;
    if (row.games <= 0) continue;

    const weight =
      row.season === season
        ? 1
        : row.season === priorSeason
          ? priorWeight
          : 0;
    if (weight === 0) continue;

    seasons.add(row.season);
    if (row.season === season) liveGames = Math.max(liveGames, row.games);

    teams.add(row.team);
    const key = gradeKey(row.team, row.position);
    const bucket = pooled.get(key) ?? { points: 0, games: 0 };
    bucket.points += weight * scoredPoints(row, ppr);
    bucket.games += weight * row.games;
    pooled.set(key, bucket);
  }

  const grades = new Map<string, DefenseGrade>();
  const scales = new Map<GradedPosition, PositionScale>();

  for (const position of GRADED_POSITIONS) {
    const graded = [...teams]
      .map((team) => {
        const bucket = pooled.get(gradeKey(team, position));
        return bucket && bucket.games > 0
          ? { team, ppg: bucket.points / bucket.games }
          : null;
      })
      .filter((entry): entry is { team: string; ppg: number } => entry !== null);

    if (graded.length === 0) continue;

    const average = mean(graded.map((entry) => entry.ppg));
    const sd = stdDev(graded.map((entry) => entry.ppg), average);
    scales.set(position, { mean: average, sd });

    // Softest first, so rank 1 is the defense a manager wants to face.
    const ordered = [...graded].sort((a, b) => b.ppg - a.ppg);

    ordered.forEach((entry, index) => {
      grades.set(gradeKey(entry.team, position), {
        team: entry.team,
        position,
        ppg: entry.ppg,
        // A league with one defense has no spread to measure against, so
        // everyone sits at the mean rather than dividing by zero.
        z: sd === 0 ? 0 : (entry.ppg - average) / sd,
        rank: index + 1,
      });
    });
  }

  return {
    grades,
    scales,
    seasons: [...seasons].sort((a, b) => b - a),
    liveGames,
  };
}

export type WeekMatchup = {
  week: number;
  /** Null on a bye. */
  opponent: string | null;
  isHome: boolean;
  /** The opponent's grade, in standard deviations. Null on a bye. */
  z: number | null;
  /** 1 is the softest defense at this position. Null on a bye. */
  opponentRank: number | null;
};

export type SosTier = "easy" | "even" | "hard";

export type ScheduleStrength = {
  team: string;
  position: GradedPosition;
  /** Weeks in the window with a game. */
  games: number;
  /** Weeks in the window with none. */
  byes: number[];
  /** Mean opponent grade, in standard deviations. Positive is easier. */
  meanZ: number;
  /**
   * The same reading in points per game above or below what the average
   * defense allows this position. The figure worth printing.
   */
  pointsPerGame: number;
  /** 1 is the easiest slate among the 32 NFL teams over this window. */
  rank: number;
  outOf: number;
  tier: SosTier;
  weeks: WeekMatchup[];
};

/**
 * Rank thirds, rounded down so the two ends stay the same size: ten soft,
 * twelve level, ten tough over a 32-team league. An uneven remainder belongs
 * in the middle, where calling a slate level is the cheapest thing to be wrong
 * about.
 */
export function tierOf(rank: number, outOf: number): SosTier {
  if (outOf < 3) return "even";
  const third = Math.floor(outOf / 3);
  if (rank <= third) return "easy";
  if (rank > outOf - third) return "hard";
  return "even";
}

/**
 * Every team's slate read at every position, over one window of weeks.
 *
 * Computed for all 32 at once because the rank is the point: a single team's
 * average opponent grade means nothing until it is placed against the other
 * thirty-one.
 */
export function scheduleStrength(
  schedule: ScheduleRow[],
  board: DefenseBoard,
  weeks: number[],
): Map<string, ScheduleStrength> {
  const byTeam = new Map<string, Map<number, ScheduleRow>>();
  for (const row of schedule) {
    const team = byTeam.get(row.team) ?? new Map<number, ScheduleRow>();
    team.set(row.week, row);
    byTeam.set(row.team, team);
  }

  const out = new Map<string, ScheduleStrength>();
  const window = [...new Set(weeks)].sort((a, b) => a - b);

  for (const position of GRADED_POSITIONS) {
    const scale = board.scales.get(position);
    if (!scale) continue;

    const readings: ScheduleStrength[] = [];

    for (const [team, slate] of byTeam) {
      const matchups: WeekMatchup[] = [];
      const byes: number[] = [];
      const zs: number[] = [];

      for (const week of window) {
        const game = slate.get(week);
        if (!game) {
          byes.push(week);
          matchups.push({
            week,
            opponent: null,
            isHome: false,
            z: null,
            opponentRank: null,
          });
          continue;
        }

        const grade = board.grades.get(gradeKey(game.opponent, position));
        if (grade) zs.push(grade.z);
        matchups.push({
          week,
          opponent: game.opponent,
          isHome: game.isHome,
          z: grade?.z ?? null,
          opponentRank: grade?.rank ?? null,
        });
      }

      // A team with no graded opponent in the window has no reading. Better an
      // absent row than a zero that reads as "perfectly average".
      if (zs.length === 0) continue;

      const meanZ = mean(zs);

      readings.push({
        team,
        position,
        games: zs.length,
        byes,
        meanZ,
        pointsPerGame: meanZ * scale.sd,
        rank: 0,
        outOf: 0,
        tier: "even",
        weeks: matchups,
      });
    }

    readings.sort((a, b) => b.meanZ - a.meanZ);

    readings.forEach((reading, index) => {
      const ranked: ScheduleStrength = {
        ...reading,
        rank: index + 1,
        outOf: readings.length,
        tier: tierOf(index + 1, readings.length),
      };
      out.set(gradeKey(reading.team, position), ranked);
    });
  }

  return out;
}

/**
 * One player's reading, or null wherever the question does not apply: a free
 * agent has no slate, and a kicker or a team defense is not graded because
 * "points allowed to opposing kickers" is not a matchup anybody streams on.
 */
export function findReading(
  readings: Map<string, ScheduleStrength>,
  nflTeam: string | null | undefined,
  position: string | null | undefined,
): ScheduleStrength | null {
  if (!nflTeam || !position) return null;
  return readings.get(gradeKey(nflTeam, position.toUpperCase())) ?? null;
}

/**
 * A whole lineup's schedule as one figure.
 *
 * Points per game against the average defense is the same unit at every
 * position, which is exactly what makes it summable: a roster whose starters
 * average +1.4 has a schedule worth about a point and a half a week at each
 * slot. Ungraded starters are counted separately rather than folded in at
 * zero, because "no reading" is not "average".
 */
export function averageReading(
  readings: (ScheduleStrength | null)[],
): { pointsPerGame: number; graded: number } | null {
  const found = readings.filter(
    (reading): reading is ScheduleStrength => reading !== null,
  );
  if (found.length === 0) return null;

  return {
    pointsPerGame: mean(found.map((reading) => reading.pointsPerGame)),
    graded: found.length,
  };
}

/** Inclusive week range, clamped to the NFL's own eighteen. */
export function weekWindow(from: number, to: number): number[] {
  const start = Math.max(1, Math.min(18, from));
  const end = Math.max(start, Math.min(18, to));
  const weeks: number[] = [];
  for (let week = start; week <= end; week += 1) weeks.push(week);
  return weeks;
}

/** The two schedule windows a redraft manager actually asks about (§6). */
export type SosWindowKey = "ros" | "playoffs";

export type LeagueClock = {
  season: number;
  priorSeason: number;
  ppr: number;
  currentWeek: number | null;
  startWeek: number | null;
  endWeek: number | null;
};

/** §6 calls the fantasy playoffs weeks 15-17; a league that ends early moves them. */
export const PLAYOFF_WEEKS = 3;

/**
 * Which weeks each window covers, for one league's own calendar.
 *
 * Rest of season starts at the live week rather than at week one, because a
 * roster is a claim on what is left rather than on what has been played.
 * Before kickoff there is no live week and the answer is the whole slate,
 * which falls out of the same arithmetic instead of needing its own branch.
 */
export function windowsFor(clock: LeagueClock): Record<SosWindowKey, number[]> {
  const start = Math.max(1, clock.startWeek ?? 1);
  const end = Math.max(start, clock.endWeek ?? 17);
  // Clamped to the end as well as the start: a league whose season is behind
  // it would otherwise be read over a week it never plays.
  const from = Math.min(end, Math.max(start, clock.currentWeek ?? start));

  return {
    ros: weekWindow(from, end),
    // The league tells us when it ends but not when its playoffs start, so the
    // last three weeks of its own window are the assumption, stated in the UI
    // rather than hidden here.
    playoffs: weekWindow(Math.max(start, end - (PLAYOFF_WEEKS - 1)), end),
  };
}

import { normalizeTeam } from "@/lib/crosswalk/resolve";

import { forEachCsvRow } from "./csv";

/**
 * nflverse's weekly player stats, folded straight into the season aggregate
 * strength of schedule needs.
 *
 * Why a fifth source at all: the app already stores every player's week-by-week
 * points, but not the team he played for *that week*. The player master carries
 * the team he is on today, and measured against nflverse's 2025 file a quarter
 * of last season's skill-position player-weeks were played somewhere else --
 * enough to shift a defense's rank by four or five places and drop the rank
 * correlation against the truth to 0.67 at wide receiver. A points-allowed
 * table built that way would be a plausible-looking number that is wrong, which
 * is the one thing §13 asks this app not to ship.
 *
 * nflverse carries `team` and `opponent_team` on every row, so the attribution
 * is exact rather than inferred.
 *
 * Points are kept in two pieces, never one: `pointsStd` is nflverse's
 * reception-free `fantasy_points`, and `receptions` is the count implied by the
 * gap to `fantasy_points_ppr`. §1.2's rule is that the league's own PPR
 * modifier decides what a line is worth, and one aggregate row is read by every
 * league in the app.
 */

/** The positions a fantasy defense is graded against. K and DEF are not among them. */
export const GRADED_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type GradedPosition = (typeof GRADED_POSITIONS)[number];

const GRADED = new Set<string>(GRADED_POSITIONS);

export type PositionScoring = {
  team: string;
  position: GradedPosition;
  /** 'for' = produced by this team; 'against' = allowed by its defense. */
  side: "for" | "against";
  games: number;
  pointsStd: number;
  receptions: number;
};

type Bucket = {
  pointsStd: number;
  receptions: number;
  weeks: Set<number>;
};

const COLUMNS = [
  "season_type",
  "week",
  "position",
  "team",
  "opponent_team",
  "fantasy_points",
  "fantasy_points_ppr",
] as const;

type Column = (typeof COLUMNS)[number];

function number(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Folds one season's weekly file into 32 x 4 x 2 rows.
 *
 * Only the regular season counts. A playoff game is played by fourteen teams
 * against a field that is by definition above average, and no fantasy league
 * scores those weeks anyway.
 */
export function parseWeeklyScoring(csv: string): PositionScoring[] {
  const buckets = new Map<string, Bucket>();
  let index: Partial<Record<Column, number>> = {};
  let header = false;

  const add = (
    team: string,
    position: string,
    side: "for" | "against",
    week: number,
    pointsStd: number,
    receptions: number,
  ) => {
    const key = `${team}:${position}:${side}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { pointsStd: 0, receptions: 0, weeks: new Set() };
      buckets.set(key, bucket);
    }
    bucket.pointsStd += pointsStd;
    bucket.receptions += receptions;
    bucket.weeks.add(week);
  };

  forEachCsvRow(csv, (cells) => {
    if (!header) {
      index = Object.fromEntries(
        COLUMNS.map((name) => [name, cells.indexOf(name)]),
      ) as Partial<Record<Column, number>>;
      header = true;
      return;
    }

    const at = (name: Column) => {
      const position = index[name];
      return position === undefined || position < 0
        ? undefined
        : cells[position];
    };

    if ((at("season_type") ?? "").toUpperCase() !== "REG") return;

    const position = (at("position") ?? "").toUpperCase();
    if (!GRADED.has(position)) return;

    const week = Number(at("week"));
    if (!Number.isInteger(week) || week < 1 || week > 18) return;

    const team = normalizeTeam(at("team"));
    const opponent = normalizeTeam(at("opponent_team"));
    if (!team || !opponent) return;

    const pointsStd = number(at("fantasy_points"));
    // nflverse's own two columns differ by exactly one point per catch, so the
    // gap is the reception count -- read rather than stored, because the file
    // does not carry receptions for a rushing quarterback's line at all.
    const receptions = number(at("fantasy_points_ppr")) - pointsStd;

    add(team, position, "for", week, pointsStd, receptions);
    add(opponent, position, "against", week, pointsStd, receptions);
  });

  return [...buckets].map(([key, bucket]) => {
    const [team, position, side] = key.split(":");
    return {
      team,
      position: position as GradedPosition,
      side: side as "for" | "against",
      games: bucket.weeks.size,
      pointsStd: Math.round(bucket.pointsStd * 100) / 100,
      receptions: Math.round(bucket.receptions * 100) / 100,
    };
  });
}

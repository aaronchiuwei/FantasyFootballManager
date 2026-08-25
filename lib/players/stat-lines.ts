/**
 * The stat surface of Requirement 4 — "current and projected stats" — as a
 * pure function of the two stored tables.
 *
 * `player_stats` and `player_projections` are mirrored: same key, same shape,
 * one holds what happened and the other what is expected to. Everything the
 * detail page shows is a join of those two on `(season, week)` plus this
 * league's own scoring, so it is all arithmetic and belongs here rather than
 * in a component or a view. No `server-only`: nothing in this file touches a
 * database or a network.
 *
 * Scoring is applied on read, never trusted from the stored `pts_ppr`, for the
 * same reason the value engine re-applies it (§1.2): one row is shared by every
 * league in the app, and the league's own PPR modifier decides what it is worth.
 */
import { scoredPoints, type StatLine } from "@/lib/sources/sleeper-parse";

/** `week: 0` is the season total on both tables (§8). */
export const SEASON_TOTAL_WEEK = 0;

/** A row of `player_stats` or `player_projections`, as stored. */
export type StoredLine = {
  week: number;
  stats: Record<string, number>;
  ptsPpr: number | null;
};

/** One week, with both sides of it. Either side may be missing. */
export type WeekLine = {
  week: number;
  actual: number | null;
  projected: number | null;
  actualStats: Record<string, number> | null;
  projectedStats: Record<string, number> | null;
};

export type SeasonTotal = {
  actual: number | null;
  projected: number | null;
  /** Games played, from Sleeper's own `gp` where it exists. */
  gamesPlayed: number | null;
};

export type SeasonLines = {
  season: number;
  total: SeasonTotal;
  /** Ascending, and only weeks that either side has something for. */
  weeks: WeekLine[];
  /** True when a game has actually been played — the preseason test (§12). */
  hasActuals: boolean;
  hasProjections: boolean;
};

function asStatLine(line: StoredLine): StatLine {
  return { sleeperId: "", ptsPpr: line.ptsPpr, stats: line.stats };
}

function points(line: StoredLine | undefined, ppr: number): number | null {
  return line === undefined ? null : scoredPoints(asStatLine(line), ppr);
}

function byWeek(lines: StoredLine[]): Map<number, StoredLine> {
  return new Map(lines.map((line) => [line.week, line]));
}

function sum(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/**
 * Merges one season's actuals and projections into what the page renders.
 *
 * The season total prefers Sleeper's own `week: 0` row over the sum of the
 * weekly grid, because the grid deliberately drops lines with no scoring in
 * them and a sum of what survived is not the same number. Summing is the
 * fallback for a season whose totals were never pulled.
 */
export function buildSeasonLines({
  season,
  actuals,
  projections,
  ppr,
}: {
  season: number;
  actuals: StoredLine[];
  projections: StoredLine[];
  ppr: number;
}): SeasonLines {
  const actualByWeek = byWeek(actuals);
  const projectedByWeek = byWeek(projections);

  const weekNumbers = [
    ...new Set([...actualByWeek.keys(), ...projectedByWeek.keys()]),
  ]
    .filter((week) => week !== SEASON_TOTAL_WEEK)
    .sort((a, b) => a - b);

  const weeks: WeekLine[] = weekNumbers.map((week) => {
    const actual = actualByWeek.get(week);
    const projected = projectedByWeek.get(week);

    return {
      week,
      actual: points(actual, ppr),
      projected: points(projected, ppr),
      actualStats: actual?.stats ?? null,
      projectedStats: projected?.stats ?? null,
    };
  });

  const actualTotal = actualByWeek.get(SEASON_TOTAL_WEEK);
  const projectedTotal = projectedByWeek.get(SEASON_TOTAL_WEEK);

  const playedWeeks = weeks.filter((week) => week.actual !== null);

  return {
    season,
    total: {
      actual:
        points(actualTotal, ppr) ?? sum(playedWeeks.map((week) => week.actual)),
      projected:
        points(projectedTotal, ppr) ??
        sum(weeks.map((week) => week.projected)),
      gamesPlayed:
        actualTotal?.stats.gp ??
        (playedWeeks.length === 0 ? null : playedWeeks.length),
    },
    weeks,
    hasActuals: actualTotal !== undefined || playedWeeks.length > 0,
    hasProjections:
      projectedTotal !== undefined ||
      weeks.some((week) => week.projected !== null),
  };
}

// ---------------------------------------------------------------------------
// the box score, per position
// ---------------------------------------------------------------------------

export type StatColumn = {
  /** Sleeper's own key. */
  key: string;
  label: string;
  digits: number;
};

const PASSING: StatColumn[] = [
  { key: "pass_yd", label: "Pa yd", digits: 0 },
  { key: "pass_td", label: "Pa TD", digits: 1 },
  { key: "pass_int", label: "INT", digits: 1 },
];

const RUSHING: StatColumn[] = [
  { key: "rush_att", label: "Ru att", digits: 1 },
  { key: "rush_yd", label: "Ru yd", digits: 0 },
  { key: "rush_td", label: "Ru TD", digits: 1 },
];

const RECEIVING: StatColumn[] = [
  { key: "rec_tgt", label: "Tgt", digits: 1 },
  { key: "rec", label: "Rec", digits: 1 },
  { key: "rec_yd", label: "Re yd", digits: 0 },
  { key: "rec_td", label: "Re TD", digits: 1 },
];

/** Receiving without the target count — a back's targets are the least of it. */
const RECEIVING_SECONDARY = RECEIVING.filter(
  (column) => column.key !== "rec_tgt",
);

/**
 * The handful of numbers that make a line legible for the position.
 *
 * Sleeper ships forty-odd keys on a single game — snap counts, air yards,
 * red-zone attempts. Showing all of them is showing none of them. The rule
 * here is the one a box score already uses: volume, yards, touchdowns, and
 * whatever the position is actually judged on. Everything else stays in the
 * stored `stats` jsonb, where a later phase can reach it.
 *
 * Fractional digits differ by column because a *projection* is a fractional
 * quantity: 0.4 touchdowns is a real forecast, 0.4 yards is not.
 */
export function statColumnsFor(position: string | null): StatColumn[] {
  switch ((position ?? "").toUpperCase()) {
    case "QB":
      return [...PASSING, ...RUSHING];
    case "RB":
      return [...RUSHING, ...RECEIVING_SECONDARY];
    case "WR":
    case "TE":
      return [...RECEIVING, { key: "rush_yd", label: "Ru yd", digits: 0 }];
    case "K":
      return [
        { key: "fgm", label: "FGM", digits: 1 },
        { key: "fga", label: "FGA", digits: 1 },
        { key: "xpm", label: "XPM", digits: 1 },
        { key: "xpa", label: "XPA", digits: 1 },
      ];
    case "DEF":
      return [
        { key: "sack", label: "Sack", digits: 1 },
        { key: "int", label: "INT", digits: 1 },
        { key: "fum_rec", label: "FR", digits: 1 },
        { key: "def_td", label: "TD", digits: 1 },
        { key: "pts_allow", label: "PA", digits: 0 },
      ];
    default:
      return [];
  }
}

/** A stat Sleeper has no value for is absent, not zero. */
export function formatStat(
  stats: Record<string, number> | null,
  column: StatColumn,
): string {
  const value = stats?.[column.key];
  if (typeof value !== "number") return "—";
  return value.toFixed(column.digits);
}

/**
 * How a week came out against its own projection, as a share of the
 * projection. Null when there is nothing to compare — which in the preseason
 * is every week, and is why the page labels the column rather than showing a
 * column of dashes and calling it a comparison.
 */
export function projectionDelta(line: WeekLine): number | null {
  if (line.actual === null || line.projected === null) return null;
  if (line.projected === 0) return null;
  return (line.actual - line.projected) / line.projected;
}

import "server-only";

import {
  fetchProjections,
  fetchStats,
  gamesPlayed,
  hasScoring,
  scoredPoints,
  type StatLine,
} from "@/lib/sources/sleeper";
import type { Db } from "@/lib/supabase/db";
import type { Database, Json } from "@/lib/supabase/database.types";

import { chunk, PAGE_SIZE } from "./master";
import { SEASON_TOTAL_WEEK } from "./stat-lines";

const UPSERT_CHUNK = 500;

/**
 * `week: 0` is the season total, per the §8 comment on both tables. It lives
 * with the pure display model rather than here so the half that writes the key
 * and the half that reads it cannot drift apart.
 */
export { SEASON_TOTAL_WEEK };

/**
 * How many weeks are fetched at once. Sleeper answers a weekly payload in
 * well under a second, so a pool of four turns eighteen weeks into roughly
 * three — comfortably inside §9's ~60s budget for one stage — without opening
 * eighteen sockets at an undocumented API that has never asked us to.
 */
const FETCH_CONCURRENCY = 4;

type StatTable = "player_stats" | "player_projections";
type StatInsert = Database["public"]["Tables"]["player_stats"]["Insert"];

/** Which of the two mirrored tables a pull belongs in. */
export type StatKind = "actual" | "projected";

const TABLE_FOR: Record<StatKind, StatTable> = {
  actual: "player_stats",
  projected: "player_projections",
};

type StatFetch = (season: number, week?: number) => Promise<StatLine[]>;

const FETCH_FOR: Record<StatKind, StatFetch> = {
  actual: fetchStats,
  projected: fetchProjections,
};

export type SeasonLine = {
  playerId: number;
  points: number | null;
  gamesPlayed: number | null;
};

function toRows(
  lines: StatLine[],
  ids: Map<string, number>,
  season: number,
  week: number,
): StatInsert[] {
  const rows = new Map<number, StatInsert>();

  for (const line of lines) {
    const playerId = ids.get(line.sleeperId);
    if (playerId === undefined) continue;

    // Only on the weekly grid. A season total with no points still says
    // something — the player exists and is projected at nothing — and the
    // value engine has read those rows since Phase 3. A *week* with no points
    // says nothing at all, and eighteen of them per player is a table full of
    // rows whose only content is that Sleeper listed everybody.
    if (week !== SEASON_TOTAL_WEEK && !hasScoring(line)) continue;

    rows.set(playerId, {
      player_id: playerId,
      season,
      week,
      stats: line.stats as unknown as Json,
      pts_ppr: line.ptsPpr,
    });
  }

  return [...rows.values()];
}

async function write(db: Db, table: StatTable, rows: StatInsert[]) {
  for (const batch of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await db
      .from(table)
      .upsert(batch, { onConflict: "player_id,season,week" });

    if (error) throw new Error(`Failed to save ${table}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// what stages 4 and 5 pull
// ---------------------------------------------------------------------------

export type WeekCoverage = {
  season: number;
  week: number;
  kind: StatKind;
  players: number;
  fetchedAt: string;
};

function coverageKey(kind: StatKind, week: number): string {
  return `${kind}:${week}`;
}

/**
 * What has already been pulled for a season, keyed `${kind}:${week}`.
 *
 * This is the record that lets a stage skip work rather than re-download a
 * finished season on every sync. It lives in Postgres for the same reason
 * everything else in §9 does: the stage that would use it is a different
 * invocation from the stage that wrote it.
 */
export async function loadCoverage(
  db: Db,
  seasons: number[],
): Promise<Map<string, WeekCoverage>> {
  const coverage = new Map<string, WeekCoverage>();
  if (seasons.length === 0) return coverage;

  const { data, error } = await db
    .from("stat_coverage")
    .select("season, week, kind, players, fetched_at")
    .in("season", seasons);

  if (error) throw new Error(`Failed to read stat coverage: ${error.message}`);

  for (const row of data ?? []) {
    const kind = row.kind as StatKind;
    coverage.set(`${row.season}:${coverageKey(kind, row.week)}`, {
      season: row.season,
      week: row.week,
      kind,
      players: row.players,
      fetchedAt: row.fetched_at,
    });
  }

  return coverage;
}

export type StatSync = {
  /** Weeks actually fetched. `0` is the season total, not a week. */
  weeks: number[];
  /** Weeks left alone because they are settled and already pulled. */
  skipped: number[];
  rows: number;
};

/**
 * Pulls a season total and/or a set of weeks for one kind, and records what
 * landed in `stat_coverage`.
 *
 * Stages hand each other work through Postgres, not through memory, so this
 * only writes — the value engine reads the season totals back out with
 * `loadSeasonTotals` and the detail page reads the weekly grid back out with
 * `loadPlayerDetail`. That indirection is the whole point: stage 8 can be
 * retried on its own without re-downloading anything.
 *
 * `frozenWeeks` is the set the caller considers final — every week of a
 * finished season, or a regular-season week already behind the live one. Those
 * are fetched once and never again, which is what keeps a stage with eighteen
 * weeks in its window from paying for all of them on every run. The
 * consequence, stated rather than hidden: a stat correction applied to a week
 * that has already been pulled is not chased.
 */
export async function syncStatLines(
  db: Db,
  ids: Map<string, number>,
  {
    season,
    kind,
    weeks,
    frozenWeeks = new Set<number>(),
    coverage,
  }: {
    season: number;
    kind: StatKind;
    /** Include `SEASON_TOTAL_WEEK` to pull the season total alongside. */
    weeks: number[];
    frozenWeeks?: Set<number>;
    coverage: Map<string, WeekCoverage>;
  },
): Promise<StatSync> {
  const skipped: number[] = [];
  const wanted = weeks.filter((week) => {
    const covered = coverage.has(`${season}:${coverageKey(kind, week)}`);
    if (covered && frozenWeeks.has(week)) {
      skipped.push(week);
      return false;
    }
    return true;
  });

  const table = TABLE_FOR[kind];
  const fetch = FETCH_FOR[kind];
  const fetchedAt = new Date().toISOString();
  let total = 0;

  for (const batch of chunk(wanted, FETCH_CONCURRENCY)) {
    const pulled = await Promise.all(
      batch.map(async (week) => ({
        week,
        // The season total is a different path, not week zero of one — §3's
        // `/regular/{season}` against `/regular/{season}/{week}`.
        rows: toRows(
          await fetch(
            season,
            week === SEASON_TOTAL_WEEK ? undefined : week,
          ),
          ids,
          season,
          week,
        ),
      })),
    );

    for (const { week, rows } of pulled) {
      await write(db, table, rows);
      total += rows.length;

      const { error } = await db.from("stat_coverage").upsert(
        {
          season,
          week,
          kind,
          players: rows.length,
          fetched_at: fetchedAt,
        },
        { onConflict: "season,kind,week" },
      );

      if (error) {
        throw new Error(`Failed to record stat coverage: ${error.message}`);
      }
    }
  }

  return { weeks: wanted, skipped, rows: total };
}

export type SeasonTotals = {
  projections: Map<number, SeasonLine>;
  actuals: Map<number, SeasonLine>;
};

async function readSeason(
  db: Db,
  table: StatTable,
  season: number,
  ppr: number,
): Promise<Map<number, SeasonLine>> {
  const lines = new Map<number, SeasonLine>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select("player_id, stats, pts_ppr")
      .eq("season", season)
      .eq("week", SEASON_TOTAL_WEEK)
      .order("player_id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);

    for (const row of data ?? []) {
      // Scoring is re-applied on read rather than trusted from the stored
      // `pts_ppr`, because §1.2's rule is that the league's own PPR modifier
      // decides — and two leagues share one row here.
      const line: StatLine = {
        sleeperId: "",
        ptsPpr: row.pts_ppr,
        stats: (row.stats ?? {}) as Record<string, number>,
      };

      lines.set(row.player_id, {
        playerId: row.player_id,
        points: scoredPoints(line, ppr),
        gamesPlayed: gamesPlayed(line),
      });
    }

    if (!data || data.length < PAGE_SIZE) break;
  }

  return lines;
}

/**
 * Reads back what stages 4 and 5 wrote, scored for this league.
 *
 * Absent actuals are an empty map, not an error: that is exactly the preseason
 * state, and the engine's blend already handles it.
 */
export async function loadSeasonTotals(
  db: Db,
  { season, ppr }: { season: number; ppr: number },
): Promise<SeasonTotals> {
  const [projections, actuals] = await Promise.all([
    readSeason(db, "player_projections", season, ppr),
    readSeason(db, "player_stats", season, ppr),
  ]);

  return { projections, actuals };
}

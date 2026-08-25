import "server-only";

import {
  fetchProjections,
  fetchStats,
  gamesPlayed,
  scoredPoints,
  type StatLine,
} from "@/lib/sources/sleeper";
import type { Db } from "@/lib/supabase/db";
import type { Database, Json } from "@/lib/supabase/database.types";

import { chunk, PAGE_SIZE } from "./master";

const UPSERT_CHUNK = 500;

/** `week: 0` is the season total, per the §8 comment on both tables. */
export const SEASON_TOTAL_WEEK = 0;

type StatTable = "player_stats" | "player_projections";
type StatInsert = Database["public"]["Tables"]["player_stats"]["Insert"];

export type SeasonLine = {
  playerId: number;
  points: number | null;
  gamesPlayed: number | null;
};

function toRows(
  lines: StatLine[],
  ids: Map<string, number>,
  season: number,
): StatInsert[] {
  const rows = new Map<number, StatInsert>();

  for (const line of lines) {
    const playerId = ids.get(line.sleeperId);
    if (playerId === undefined) continue;

    rows.set(playerId, {
      player_id: playerId,
      season,
      week: SEASON_TOTAL_WEEK,
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

/**
 * Sync stage 4: Sleeper's season-total projections, persisted.
 *
 * Stages hand each other work through Postgres, not through memory, so this
 * only writes — the value engine reads the same numbers back out with
 * `loadSeasonTotals`. That indirection is the whole point: stage 8 can be
 * retried on its own without re-downloading anything.
 */
export async function syncProjections(
  db: Db,
  ids: Map<string, number>,
  season: number,
): Promise<number> {
  const rows = toRows(await fetchProjections(season), ids, season);
  await write(db, "player_projections", rows);
  return rows.length;
}

/**
 * Sync stage 5: season-to-date actuals.
 *
 * Only meaningful once games have been played — in the preseason
 * `/stats/nfl/regular/{season}` is empty or absent, and §5's blend already
 * weights actuals at zero when `gamesPlayed` is 0. The caller skips the stage
 * outright rather than treating an empty payload as a failure.
 */
export async function syncActuals(
  db: Db,
  ids: Map<string, number>,
  season: number,
): Promise<number> {
  const rows = toRows(await fetchStats(season), ids, season);
  await write(db, "player_stats", rows);
  return rows.length;
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

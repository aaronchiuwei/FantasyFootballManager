import "server-only";

import {
  fetchProjections,
  fetchStats,
  gamesPlayed,
  scoredPoints,
  type StatLine,
} from "@/lib/sources/sleeper";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";

import { chunk, type PlayerRow } from "./master";

type Admin = ReturnType<typeof createAdminClient>;

const UPSERT_CHUNK = 500;

/** `week: 0` is the season total, per the §8 comment on both tables. */
export const SEASON_TOTAL_WEEK = 0;

export type SeasonLine = {
  playerId: number;
  points: number | null;
  gamesPlayed: number | null;
};

function bySleeperId(players: PlayerRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const player of players) {
    if (player.sleeper_id) map.set(player.sleeper_id, player.id);
  }
  return map;
}

function toRows(
  lines: StatLine[],
  ids: Map<string, number>,
  season: number,
): Database["public"]["Tables"]["player_stats"]["Insert"][] {
  const rows = new Map<
    number,
    Database["public"]["Tables"]["player_stats"]["Insert"]
  >();

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

async function write(
  admin: Admin,
  table: "player_stats" | "player_projections",
  rows: Database["public"]["Tables"]["player_stats"]["Insert"][],
) {
  for (const batch of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await admin
      .from(table)
      .upsert(batch, { onConflict: "player_id,season,week" });

    if (error) throw new Error(`Failed to save ${table}: ${error.message}`);
  }
}

function toSeasonLines(
  lines: StatLine[],
  ids: Map<string, number>,
  ppr: number,
): Map<number, SeasonLine> {
  const map = new Map<number, SeasonLine>();

  for (const line of lines) {
    const playerId = ids.get(line.sleeperId);
    if (playerId === undefined) continue;

    map.set(playerId, {
      playerId,
      points: scoredPoints(line, ppr),
      gamesPlayed: gamesPlayed(line),
    });
  }

  return map;
}

export type SeasonTotals = {
  projections: Map<number, SeasonLine>;
  actuals: Map<number, SeasonLine>;
  warnings: string[];
};

/**
 * Pulls season-total projections and actuals from Sleeper, persists both
 * (stages 4 and 5 of the §9 pipeline) and hands back the same numbers scored
 * for this league, so the value engine does not have to read them straight
 * back out of Postgres.
 *
 * Actuals are optional by design: in the preseason `/stats/nfl/regular/{season}`
 * is empty or absent, and §5's blend already weights actuals at zero when no
 * games have been played. A missing actuals payload degrades the model to
 * projections alone rather than failing the sync.
 */
export async function syncSeasonTotals(
  admin: Admin,
  players: PlayerRow[],
  { season, ppr, includeActuals }: {
    season: number;
    ppr: number;
    includeActuals: boolean;
  },
): Promise<SeasonTotals> {
  const ids = bySleeperId(players);
  const warnings: string[] = [];

  const projectionLines = await fetchProjections(season);
  await write(admin, "player_projections", toRows(projectionLines, ids, season));

  let statLines: StatLine[] = [];
  if (includeActuals) {
    try {
      statLines = await fetchStats(season);
      await write(admin, "player_stats", toRows(statLines, ids, season));
    } catch (cause) {
      warnings.push(
        cause instanceof Error
          ? `Season actuals unavailable: ${cause.message}`
          : "Season actuals unavailable.",
      );
    }
  }

  return {
    projections: toSeasonLines(projectionLines, ids, ppr),
    actuals: toSeasonLines(statLines, ids, ppr),
    warnings,
  };
}

import "server-only";

import type { Db } from "@/lib/supabase/db";
import type { Database } from "@/lib/supabase/database.types";

import {
  loadCoverage,
  type StatKind,
  type WeekCoverage,
} from "./stats";
import {
  buildSeasonLines,
  SEASON_TOTAL_WEEK,
  type SeasonLines,
  type StoredLine,
} from "./stat-lines";

export type PlayerIdentity = {
  id: number;
  full_name: string;
  position: string | null;
  nfl_team: string | null;
  age: number | null;
  years_exp: number | null;
  status: string | null;
  injury_status: string | null;
  headshot_url: string | null;
};

export type PlayerValue =
  Database["public"]["Views"]["league_player_values"]["Row"];

/** How much of a season has been pulled, for the "as of" line on the page. */
export type SeasonCoverage = {
  season: number;
  actualWeeks: number;
  projectedWeeks: number;
  fetchedAt: string | null;
};

export type PlayerDetail = {
  player: PlayerIdentity;
  /**
   * Null when the player has no value row in this league — someone outside the
   * engine's scope entirely. §4's rule holds: the page says so rather than
   * rendering a zero.
   */
  value: PlayerValue | null;
  /** The league's own season first, then the prior one as context (§12). */
  seasons: SeasonLines[];
  coverage: Map<number, SeasonCoverage>;
};

type StatTable = "player_stats" | "player_projections";

async function readLines(
  db: Db,
  table: StatTable,
  playerId: number,
  seasons: number[],
): Promise<Map<number, StoredLine[]>> {
  const { data, error } = await db
    .from(table)
    .select("season, week, stats, pts_ppr")
    .eq("player_id", playerId)
    .in("season", seasons)
    .order("week");

  if (error) throw new Error(`Failed to read ${table}: ${error.message}`);

  const bySeason = new Map<number, StoredLine[]>(
    seasons.map((season) => [season, []]),
  );

  for (const row of data ?? []) {
    bySeason.get(row.season)?.push({
      week: row.week,
      stats: (row.stats ?? {}) as Record<string, number>,
      ptsPpr: row.pts_ppr,
    });
  }

  return bySeason;
}

function summarize(
  seasons: number[],
  coverage: Map<string, WeekCoverage>,
): Map<number, SeasonCoverage> {
  const summary = new Map<number, SeasonCoverage>(
    seasons.map((season) => [
      season,
      { season, actualWeeks: 0, projectedWeeks: 0, fetchedAt: null },
    ]),
  );

  for (const entry of coverage.values()) {
    const season = summary.get(entry.season);
    // Week 0 is the season total, not a week of the grid.
    if (!season || entry.week === SEASON_TOTAL_WEEK) continue;

    const kind: StatKind = entry.kind;
    if (kind === "actual") season.actualWeeks += 1;
    else season.projectedWeeks += 1;

    if (season.fetchedAt === null || entry.fetchedAt > season.fetchedAt) {
      season.fetchedAt = entry.fetchedAt;
    }
  }

  return summary;
}

/**
 * Everything the player detail page renders, in four reads.
 *
 * Deliberately not a database view. `league_player_values` earned one because
 * it joins four tables and pages two hundred rows; this is one player, and the
 * merge of actuals against projections is scoring arithmetic that depends on
 * the league's PPR modifier — something a view keyed only on the player cannot
 * know (§1.2). So the join happens in `stat-lines.ts`, where it is pure and
 * unit-tested, and the primary key does the work down here.
 */
export async function loadPlayerDetail(
  db: Db,
  {
    league,
    playerId,
    priorSeason,
  }: {
    league: { id: string; season: number; ppr: number };
    playerId: number;
    priorSeason: number;
  },
): Promise<PlayerDetail | null> {
  const seasons = [league.season, priorSeason];

  const [
    { data: player, error: playerError },
    { data: value },
    actuals,
    projections,
    coverage,
  ] = await Promise.all([
    db
      .from("players")
      .select(
        "id, full_name, position, nfl_team, age, years_exp, status, injury_status, headshot_url",
      )
      .eq("id", playerId)
      .maybeSingle(),
    db
      .from("league_player_values")
      .select("*")
      .eq("league_id", league.id)
      .eq("player_id", playerId)
      .maybeSingle(),
    readLines(db, "player_stats", playerId, seasons),
    readLines(db, "player_projections", playerId, seasons),
    loadCoverage(db, seasons),
  ]);

  if (playerError) {
    throw new Error(`Failed to read player: ${playerError.message}`);
  }
  if (!player) return null;

  return {
    player,
    value: value ?? null,
    seasons: seasons.map((season) =>
      buildSeasonLines({
        season,
        actuals: actuals.get(season) ?? [],
        projections: projections.get(season) ?? [],
        ppr: league.ppr,
      }),
    ),
    coverage: summarize(seasons, coverage),
  };
}

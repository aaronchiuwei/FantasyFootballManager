import "server-only";

import { fetchNflSchedule } from "@/lib/sources/nfl-schedule";
import { fetchSeasonScoring } from "@/lib/sources/nflverse";
import type { Db } from "@/lib/supabase/db";
import type { Database } from "@/lib/supabase/database.types";

import {
  defenseBoard,
  scheduleStrength,
  windowsFor,
  type DefenseBoard,
  type LeagueClock,
  type ScheduleStrength,
  type ScoringRow,
  type SosWindowKey,
} from "./sos";

export { averageReading, findReading, PLAYOFF_WEEKS, windowsFor } from "./sos";
export type {
  LeagueClock,
  ScheduleStrength,
  SosTier,
  SosWindowKey,
} from "./sos";

const UPSERT_CHUNK = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// what the sync writes
// ---------------------------------------------------------------------------

type ScheduleInsert = Database["public"]["Tables"]["nfl_schedule"]["Insert"];
type ScoringInsert =
  Database["public"]["Tables"]["nfl_position_scoring"]["Insert"];

export type ScheduleSync = { seasons: number[]; rows: number };

/** The slate for each season, rewritten whole. Flexed games move; a rewrite is the fix. */
export async function syncNflSchedule(
  db: Db,
  seasons: number[],
): Promise<ScheduleSync> {
  const landed: number[] = [];
  let rows = 0;

  for (const season of [...new Set(seasons)]) {
    const games = await fetchNflSchedule(season);
    if (games.length === 0) continue;

    const inserts: ScheduleInsert[] = games.map((game) => ({
      season,
      week: game.week,
      team: game.team,
      opponent: game.opponent,
      is_home: game.isHome,
      kickoff: game.kickoff,
    }));

    for (const batch of chunk(inserts, UPSERT_CHUNK)) {
      const { error } = await db
        .from("nfl_schedule")
        .upsert(batch, { onConflict: "season,week,team" });

      if (error) throw new Error(`Failed to save NFL schedule: ${error.message}`);
    }

    landed.push(season);
    rows += inserts.length;
  }

  return { seasons: landed, rows };
}

export type ScoringSync = { seasons: number[]; skipped: number[]; rows: number };

/**
 * Points scored and allowed by position, per team, per season.
 *
 * A finished season is pulled once and then left alone, the same rule
 * `stat_coverage` applies to the game log: its aggregate cannot change, and
 * the file behind it is 1.2 MB. The live season is re-folded on every run,
 * because a week was just added to it.
 */
export async function syncPositionScoring(
  db: Db,
  {
    season,
    priorSeason,
    liveSeason,
  }: { season: number; priorSeason: number; liveSeason: number },
): Promise<ScoringSync> {
  const wanted = [...new Set([season, priorSeason])].filter(
    (year) => year <= liveSeason,
  );

  const { data: existing, error: readError } = await db
    .from("nfl_position_scoring")
    .select("season")
    .in("season", wanted);

  if (readError) {
    throw new Error(`Failed to read position scoring: ${readError.message}`);
  }

  const stored = new Set((existing ?? []).map((row) => row.season));

  const landed: number[] = [];
  const skipped: number[] = [];
  let rows = 0;

  for (const year of wanted) {
    // Frozen: a season behind the live one is finished, and one already folded
    // is not folded twice.
    if (year < liveSeason && stored.has(year)) {
      skipped.push(year);
      continue;
    }

    const scoring = await fetchSeasonScoring(year);
    if (scoring.length === 0) continue;

    const inserts: ScoringInsert[] = scoring.map((row) => ({
      season: year,
      team: row.team,
      position: row.position,
      side: row.side,
      games: row.games,
      points_std: row.pointsStd,
      receptions: row.receptions,
      computed_at: new Date().toISOString(),
    }));

    for (const batch of chunk(inserts, UPSERT_CHUNK)) {
      const { error } = await db
        .from("nfl_position_scoring")
        .upsert(batch, { onConflict: "season,team,position,side" });

      if (error) {
        throw new Error(`Failed to save position scoring: ${error.message}`);
      }
    }

    landed.push(year);
    rows += inserts.length;
  }

  return { seasons: landed, skipped, rows };
}

// ---------------------------------------------------------------------------
// what the surfaces read
// ---------------------------------------------------------------------------

export type SosWindow = {
  key: SosWindowKey;
  label: string;
  weeks: number[];
  readings: Map<string, ScheduleStrength>;
};

export type LeagueSos = {
  season: number;
  /** Seasons behind the defense grades, newest first. */
  seasons: number[];
  /** Games of the live season in those grades. Zero before Week 1 is played. */
  liveGames: number;
  windows: Record<SosWindowKey, SosWindow>;
  /** False when nothing has been synced yet, which every surface must say. */
  ready: boolean;
};

const WINDOW_LABELS: Record<SosWindowKey, string> = {
  ros: "Rest of season",
  playoffs: "Playoff weeks",
};

/**
 * Everything the overview and the values board need to print a schedule
 * reading, in two reads: one season's slate and two seasons of aggregates.
 */
export async function loadLeagueSos(
  db: Db,
  clock: LeagueClock,
): Promise<LeagueSos> {
  const [{ data: slate }, { data: scoring }] = await Promise.all([
    db
      .from("nfl_schedule")
      .select("week, team, opponent, is_home")
      .eq("season", clock.season),
    db
      .from("nfl_position_scoring")
      .select("season, team, position, side, games, points_std, receptions")
      .in("season", [clock.season, clock.priorSeason])
      .eq("side", "against"),
  ]);

  const windows = windowsFor(clock);

  const rows: ScoringRow[] = (scoring ?? []).map((row) => ({
    season: row.season,
    team: row.team,
    position: row.position,
    side: "against",
    games: row.games,
    pointsStd: Number(row.points_std),
    receptions: Number(row.receptions),
  }));

  const board: DefenseBoard = defenseBoard(rows, {
    season: clock.season,
    priorSeason: clock.priorSeason,
    ppr: clock.ppr,
  });

  const schedule = (slate ?? []).map((row) => ({
    week: row.week,
    team: row.team,
    opponent: row.opponent,
    isHome: row.is_home,
  }));

  const ready = schedule.length > 0 && board.grades.size > 0;

  const build = (key: SosWindowKey): SosWindow => ({
    key,
    label: WINDOW_LABELS[key],
    weeks: windows[key],
    readings: ready
      ? scheduleStrength(schedule, board, windows[key])
      : new Map<string, ScheduleStrength>(),
  });

  return {
    season: clock.season,
    seasons: board.seasons,
    liveGames: board.liveGames,
    windows: { ros: build("ros"), playoffs: build("playoffs") },
    ready,
  };
}

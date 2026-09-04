import "server-only";

import {
  loadCoverage,
  SEASON_TOTAL_WEEK,
  syncStatLines,
} from "@/lib/players/stats";
import { loadSleeperIds, syncPlayerMaster } from "@/lib/players/master";
import { fetchNflState } from "@/lib/sources/sleeper";
import type { Db } from "@/lib/supabase/db";
import {
  SCORING_CHOICES,
  type OpenScoring,
} from "@/lib/trades/open-market";
import { SEASON_WEEKS } from "@/lib/values/vor";

import {
  playedWeeks,
  priorSeasonWeeks,
  scheduleWeeks,
  weeksRemainingFor,
} from "./clock";
import { marketParamsKey, syncMarketValues, type MarketParams } from "./market";
import type { SyncContext } from "./plan";

/** Every FantasyCalc board the open analyzer can ask for (§6, without a league). */
export function allOpenScorings(): OpenScoring[] {
  const boards: OpenScoring[] = [];

  for (const numQbs of SCORING_CHOICES.numQbs) {
    for (const numTeams of SCORING_CHOICES.numTeams) {
      for (const ppr of SCORING_CHOICES.ppr) {
        boards.push({ numQbs, numTeams, ppr });
      }
    }
  }

  return boards;
}

function settledWeeks(context: SyncContext): Set<number> {
  const current = context.currentWeek;
  if (!context.isRegularSeason || current === null) return new Set();
  return new Set(scheduleWeeks(context).filter((week) => week < current));
}

/**
 * A sync context keyed on the live NFL season rather than a Yahoo league.
 *
 * Stats and projections are global reference data (§8), so the cron refreshes
 * the full NFL week window. Market values still honor every scoring board the
 * open analyzer exposes, plus any league-specific configs already on file.
 */
export function nflSyncContext(nfl: {
  season: number | string;
  previous_season?: number | string | null;
  season_type: string;
  week: number;
}): SyncContext {
  const liveSeason = Number(nfl.season);
  const isRegularSeason =
    nfl.season_type === "regular" || nfl.season_type === "post";
  const currentWeek = isRegularSeason ? nfl.week : null;
  const priorSeason =
    nfl.previous_season !== undefined && nfl.previous_season !== null
      ? Number(nfl.previous_season)
      : liveSeason - 1;

  return {
    leagueKey: "",
    season: liveSeason,
    liveSeason,
    priorSeason,
    seasonType: nfl.season_type,
    isRegularSeason,
    currentWeek,
    startWeek: 1,
    endWeek: SEASON_WEEKS,
    weeksRemaining: weeksRemainingFor({
      isRegularSeason,
      currentWeek,
      startWeek: 1,
      endWeek: SEASON_WEEKS,
    }),
    numTeams: 12,
    numQbs: 1,
    ppr: 1,
  };
}

function dedupeMarketParams(params: MarketParams[]): MarketParams[] {
  const seen = new Set<string>();
  const out: MarketParams[] = [];

  for (const entry of params) {
    const key = marketParamsKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }

  return out;
}

async function marketParamsToRefresh(db: Db): Promise<MarketParams[]> {
  const { data: leagues, error } = await db
    .from("leagues")
    .select("num_teams, num_qbs, ppr");

  if (error) {
    throw new Error(`Failed to read league scoring configs: ${error.message}`);
  }

  const fromLeagues = (leagues ?? []).map((league) => ({
    numQbs: league.num_qbs,
    numTeams: league.num_teams ?? 12,
    ppr: Number(league.ppr),
  }));

  return dedupeMarketParams([...allOpenScorings(), ...fromLeagues]);
}

export type GlobalRefreshReport = {
  elapsedMs: number;
  players: {
    refreshed: boolean;
    count: number;
    ageMs: number;
  };
  market: {
    boards: number;
    written: number;
    unmatched: number;
  };
  projections: {
    rows: number;
    weeks: number;
  };
  stats: {
    currentRows: number;
    currentWeeks: number;
    priorRows: number;
    priorWeeks: number;
  };
};

/**
 * Refreshes global reference data that does not need Yahoo:
 * Sleeper player master (including injury status), FantasyCalc market boards,
 * season and weekly projections, and actual stats.
 */
export async function refreshGlobalData(
  db: Db,
  /**
   * Ignore the player master's TTL and pull it again now.
   *
   * The TTL is measured against the age of the stored rows, which is the right
   * question for "is this data stale" and the wrong one for "does this data
   * still match what the code accepts". When a parser changes — the fix that
   * started keeping fullbacks, say — every player it newly admits is missing
   * until the cache happens to expire, and nothing on any screen explains why
   * a player who plainly exists cannot be found.
   *
   * So there is a lever, behind the same secret the schedule uses. Not exposed
   * to a league sync: this is a 14.6 MB pull, and one button that anybody can
   * press repeatedly is how you get rate-limited by the source you depend on.
   */
  { force = false }: { force?: boolean } = {},
): Promise<GlobalRefreshReport> {
  const started = Date.now();

  let master = await syncPlayerMaster(db, { force });
  let ids = await loadSleeperIds(db);
  if (ids.size === 0) {
    master = await syncPlayerMaster(db, { force: true });
    ids = await loadSleeperIds(db);
  }

  const marketParams = await marketParamsToRefresh(db);
  let marketWritten = 0;
  let marketUnmatched = 0;

  for (const params of marketParams) {
    const result = await syncMarketValues(db, ids, params);
    marketWritten += result.written;
    marketUnmatched += result.unmatched;
  }

  const nfl = await fetchNflState();
  const context = nflSyncContext(nfl);
  const coverage = await loadCoverage(db, [context.season, context.priorSeason]);

  const projections = await syncStatLines(db, ids, {
    season: context.season,
    kind: "projected",
    weeks: [SEASON_TOTAL_WEEK, ...scheduleWeeks(context)],
    frozenWeeks: settledWeeks(context),
    coverage,
  });

  const priorWeeks = priorSeasonWeeks();
  const prior = await syncStatLines(db, ids, {
    season: context.priorSeason,
    kind: "actual",
    weeks: [SEASON_TOTAL_WEEK, ...priorWeeks],
    frozenWeeks: new Set([SEASON_TOTAL_WEEK, ...priorWeeks]),
    coverage,
  });

  let currentRows = 0;
  let currentWeeks = 0;

  if (context.isRegularSeason) {
    const current = await syncStatLines(db, ids, {
      season: context.season,
      kind: "actual",
      weeks: [SEASON_TOTAL_WEEK, ...playedWeeks(context)],
      frozenWeeks: settledWeeks(context),
      coverage,
    });
    currentRows = current.rows;
    currentWeeks = current.weeks.filter((week) => week !== SEASON_TOTAL_WEEK).length;
  }

  return {
    elapsedMs: Date.now() - started,
    players: {
      refreshed: master.refreshed,
      count: master.count,
      ageMs: master.ageMs,
    },
    market: {
      boards: marketParams.length,
      written: marketWritten,
      unmatched: marketUnmatched,
    },
    projections: {
      rows: projections.rows,
      weeks: projections.weeks.filter((week) => week !== SEASON_TOTAL_WEEK).length,
    },
    stats: {
      currentRows,
      currentWeeks,
      priorRows: prior.rows,
      priorWeeks: prior.weeks.filter((week) => week !== SEASON_TOTAL_WEEK).length,
    },
  };
}

import "server-only";

import {
  resolvePool,
  savePlayerPool,
  seedYahooCrosswalk,
} from "@/lib/crosswalk/store";
import { importLeague, saveMatchups } from "@/lib/leagues/import";
import { loadSleeperIds, syncPlayerMaster } from "@/lib/players/master";
import {
  loadCoverage,
  SEASON_TOTAL_WEEK,
  syncStatLines,
} from "@/lib/players/stats";
import { fetchNflState } from "@/lib/sources/sleeper";
import { fetchFreeAgents, fetchMatchups, fetchRosters } from "@/lib/sources/yahoo";
import type { Db } from "@/lib/supabase/db";
import { computeLeagueValues } from "@/lib/values/store";

import {
  playedWeeks,
  priorSeasonWeeks,
  scheduleWeeks,
  weeksRemainingFor,
} from "./clock";
import { syncMarketValues } from "./market";
import type { StageId, SyncContext } from "./plan";
import type { StageOutcome } from "./run";

export type StageInput = {
  db: Db;
  userId: string;
  leagueId: string;
  context: SyncContext;
};

export type StageRunner = (input: StageInput) => Promise<StageOutcome>;

const n = (value: number) => value.toLocaleString("en-US");

function hoursAgo(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return "minutes old";
  if (hours < 24) return `${Math.round(hours)}h old`;
  return `${Math.round(hours / 24)}d old`;
}

// ---------------------------------------------------------------------------
// the eight stages of §9
// ---------------------------------------------------------------------------

/**
 * Stage 1. The season clock, plus the league parameters the later stages are
 * keyed on, resolved once and written to the run's context.
 *
 * Settings are read from the stored league row rather than from Yahoo, because
 * stage 6 is what refreshes them. A league whose scoring changed mid-season
 * therefore prices on the previous settings for exactly one sync — a real but
 * tiny lag, and the alternative is asking Yahoo for settings twice per run.
 */
const state: StageRunner = async ({ db, leagueId }) => {
  const { data: league, error } = await db
    .from("leagues")
    .select(
      "yahoo_league_key, season, num_teams, num_qbs, ppr, current_week, start_week, end_week",
    )
    .eq("id", leagueId)
    .single();

  if (error || !league) {
    throw new Error(`League not found: ${error?.message ?? leagueId}`);
  }

  const nfl = await fetchNflState();
  const liveSeason = Number(nfl.season);
  const isCurrentSeason = liveSeason === league.season;
  const isRegularSeason =
    isCurrentSeason && (nfl.season_type === "regular" || nfl.season_type === "post");
  const currentWeek = isRegularSeason ? nfl.week : null;

  const context: SyncContext = {
    leagueKey: league.yahoo_league_key,
    season: league.season,
    liveSeason,
    // Sleeper names the previous season in its own state payload; falling back
    // to `season - 1` says the same thing for a league that is not on the live
    // season, where Sleeper's answer would be about a different year.
    priorSeason:
      isCurrentSeason && nfl.previous_season
        ? Number(nfl.previous_season)
        : league.season - 1,
    seasonType: nfl.season_type,
    isRegularSeason,
    currentWeek,
    startWeek: league.start_week,
    endWeek: league.end_week,
    weeksRemaining: weeksRemainingFor({
      isRegularSeason,
      currentWeek,
      startWeek: league.start_week,
      endWeek: league.end_week,
    }),
    numTeams: league.num_teams ?? 12,
    numQbs: league.num_qbs,
    ppr: Number(league.ppr),
  };

  return {
    detail: isRegularSeason
      ? `Week ${currentWeek} of ${league.season} · ${context.weeksRemaining} weeks left`
      : `${league.season} ${nfl.season_type === "pre" ? "preseason" : nfl.season_type} · full slate ahead`,
    context,
  };
};

/** Stage 2. Sleeper's 14.6 MB player master, behind a 24h TTL (§3). */
const players: StageRunner = async ({ db }) => {
  const master = await syncPlayerMaster(db);

  if (!master.refreshed) {
    return {
      detail: `${n(master.count)} players · cached, ${hoursAgo(master.ageMs)}`,
      skipped: true,
    };
  }

  // Only a refresh brings the Sleeper rows that carry `yahoo_id`, so this is
  // the one moment the Yahoo half of the crosswalk can be re-seeded (§4).
  const ids = await loadSleeperIds(db);
  const seed = await seedYahooCrosswalk(db, ids, master.players ?? []);

  return {
    detail: `${n(master.count)} players refreshed · ${n(seed.seeded)} Yahoo ids seeded`,
    warnings: seed.warning ? [seed.warning] : [],
  };
};

/** Stage 3. The FantasyCalc board for this league's scoring. */
const values: StageRunner = async ({ db, context }) => {
  const market = await syncMarketValues(db, await loadSleeperIds(db), {
    numQbs: context.numQbs,
    numTeams: context.numTeams,
    ppr: context.ppr,
  });

  return {
    detail: `${n(market.written)} market prices · ${context.numQbs === 2 ? "superflex" : "1QB"}, ${context.numTeams} teams, ${context.ppr} PPR`,
    warnings:
      market.unmatched > 0
        ? [
            `${market.unmatched} FantasyCalc players did not match a Sleeper id and were skipped.`,
          ]
        : [],
  };
};

/**
 * Weeks whose projection is now history: everything behind the live week. A
 * projection for a game already played is never revised, so once it is pulled
 * it is done. Before kickoff nothing is settled — the whole grid is still a
 * forecast, and a forecast is exactly what a sync is for.
 */
function settledWeeks(context: SyncContext): Set<number> {
  const current = context.currentWeek;
  if (!context.isRegularSeason || current === null) return new Set();
  return new Set(scheduleWeeks(context).filter((week) => week < current));
}

/**
 * Stage 4. Projections: the season total the value engine prices off, and the
 * week-by-week grid the player pages render.
 *
 * The grid is the league's own week window rather than the NFL's, for the same
 * reason §1.2 reads scoring from Yahoo — a league that ends in week 14 has no
 * use for a week 17 projection.
 */
const projections: StageRunner = async ({ db, context }) => {
  const ids = await loadSleeperIds(db);
  const coverage = await loadCoverage(db, [context.season]);

  const written = await syncStatLines(db, ids, {
    season: context.season,
    kind: "projected",
    weeks: [SEASON_TOTAL_WEEK, ...scheduleWeeks(context)],
    frozenWeeks: settledWeeks(context),
    coverage,
  });

  const weeks = written.weeks.filter((week) => week !== SEASON_TOTAL_WEEK);

  return {
    detail: `${n(written.rows)} projected lines · season total + ${weeks.length} week${weeks.length === 1 ? "" : "s"}`,
  };
};

/**
 * Stage 5. Actuals — this season's, and last season's as context.
 *
 * §12: right now there is no current season to have actuals for. An empty
 * table is not an honest answer to Requirement 4, so the prior season's game
 * log is pulled alongside and the UI labels it for what it is. That season is
 * finished, so it is pulled exactly once and then skipped forever after.
 */
const stats: StageRunner = async ({ db, context }) => {
  const ids = await loadSleeperIds(db);
  const coverage = await loadCoverage(db, [context.season, context.priorSeason]);

  const priorWeeks = priorSeasonWeeks();
  const prior = await syncStatLines(db, ids, {
    season: context.priorSeason,
    kind: "actual",
    weeks: [SEASON_TOTAL_WEEK, ...priorWeeks],
    frozenWeeks: new Set([SEASON_TOTAL_WEEK, ...priorWeeks]),
    coverage,
  });

  const priorNote =
    prior.weeks.length === 0
      ? `${context.priorSeason} game log already stored`
      : `${n(prior.rows)} ${context.priorSeason} lines for context`;

  if (!context.isRegularSeason) {
    return {
      detail: `No games played yet — the model runs on projections alone · ${priorNote}`,
      // Nothing left to do only when the context was already in hand.
      skipped: prior.rows === 0,
    };
  }

  const current = await syncStatLines(db, ids, {
    season: context.season,
    kind: "actual",
    weeks: [SEASON_TOTAL_WEEK, ...playedWeeks(context)],
    frozenWeeks: settledWeeks(context),
    coverage,
  });

  const weeks = current.weeks.filter((week) => week !== SEASON_TOTAL_WEEK);

  return {
    detail: `${n(current.rows)} stat lines · season total + ${weeks.length} week${weeks.length === 1 ? "" : "s"} · ${priorNote}`,
  };
};

/**
 * Stage 6. Everything Yahoo knows: settings, standings, teams, rosters,
 * matchups and the top of the free-agent pool.
 *
 * The players are parked in `yahoo_player_pool` rather than resolved here, so
 * that a failure in stage 7 does not cost the free-agent pagination twice.
 */
const yahoo: StageRunner = async ({ db, userId, leagueId, context }) => {
  const imported = await importLeague(db, userId, context.leagueKey);

  const rosters = await fetchRosters(userId, context.leagueKey);
  const freeAgents = await fetchFreeAgents(userId, context.leagueKey);
  const pool = await savePlayerPool(db, leagueId, { rosters, freeAgents });

  const weeks = playedWeeks(context);
  const matchups =
    weeks.length === 0
      ? 0
      : await saveMatchups(
          db,
          leagueId,
          await fetchMatchups(userId, context.leagueKey, weeks),
        );

  const parts = [
    `${imported.teamCount} teams`,
    `${n(pool.rostered)} rostered`,
    `${n(pool.freeAgents)} free agents`,
  ];
  if (matchups > 0) parts.push(`${matchups} matchups`);

  return { detail: parts.join(" · ") };
};

/** Stage 7. The §4 resolution ladder over the pool stage 6 parked. */
const resolve: StageRunner = async ({ db, leagueId }) => {
  const report = await resolvePool(db, leagueId);

  const rate =
    report.rostered === 0
      ? null
      : Math.round((report.rosteredResolved / report.rostered) * 1000) / 10;

  const warnings: string[] = [];
  if (report.unmatched > 0) {
    warnings.push(
      `${report.unmatched} player${report.unmatched === 1 ? "" : "s"} could not be matched automatically — resolve them on the identity screen.`,
    );
  }
  // §13's bar for the crosswalk. Below it, trade math is missing real players.
  if (rate !== null && rate < 95) {
    warnings.push(`Only ${rate}% of rostered players auto-resolved (target 95%).`);
  }

  return {
    detail:
      rate === null
        ? `${n(report.freeAgentsResolved)} free agents matched`
        : `${rate}% of rosters matched · ${n(report.freeAgentsResolved)}/${n(report.freeAgents)} free agents`,
    warnings,
  };
};

/** Stage 8. The §5 value engine, over everything the earlier stages landed. */
const compute: StageRunner = async ({ db, leagueId, context }) => {
  const report = await computeLeagueValues(db, leagueId, context);

  // §13's invariants, checked on every run rather than only in tests. The
  // durable progress record is where they belong: a value board that quietly
  // stopped satisfying them should say so where someone will read it later.
  const warnings = [...report.warnings];

  if (report.seamViolations > 0) {
    warnings.push(
      `${report.seamViolations} modelled players outrank a market-priced player at their position.`,
    );
  }

  if (report.rankCorrelation !== null && report.rankCorrelation < 0.98) {
    warnings.push(
      `Fit correlates with FantasyCalc at ${report.rankCorrelation.toFixed(3)} across ${report.overlap} players — below §13's 0.98 target.`,
    );
  }

  const modelled = report.bySource.model + report.bySource.model_capped;

  return {
    detail: `${n(report.valued)} valued · ${n(report.bySource.market)} market, ${n(modelled)} modelled${
      report.bySource.floor ? `, ${n(report.bySource.floor)} unvalued` : ""
    }`,
    warnings,
  };
};

export const STAGE_RUNNERS: Record<StageId, StageRunner> = {
  state,
  players,
  values,
  projections,
  stats,
  yahoo,
  resolve,
  compute,
};

import "server-only";

import { seedFantasyCalcCrosswalkFrom } from "@/lib/crosswalk/store";
import { chunk, loadPlayers, syncPlayerMaster, type PlayerRow } from "@/lib/players/master";
import { syncSeasonTotals, type SeasonLine } from "@/lib/players/stats";
import {
  fetchFantasyCalcValues,
  type FantasyCalcPlayer,
} from "@/lib/sources/fantasycalc";
import { fetchNflState } from "@/lib/sources/sleeper";
import type { RosterSlot } from "@/lib/sources/yahoo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

import {
  computeValues,
  type EnginePlayer,
  type ValueSource,
} from "./engine";
import { SEASON_WEEKS } from "./vor";

const INSERT_CHUNK = 500;

export type ValuationReport = {
  season: number;
  week: number | null;
  weeksRemaining: number;
  preseason: boolean;
  valued: number;
  rostered: number;
  rosteredMarket: number;
  bySource: Record<ValueSource, number>;
  overlap: number;
  rankCorrelation: number | null;
  seamViolations: number;
  /** FantasyCalc rows that never found a player — a crosswalk miss, not a gap. */
  marketUnmatched: number;
  kdefCap: number;
  warnings: string[];
};

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function rosteredPlayerIds(
  supabase: ServerClient,
  leagueId: string,
): Promise<Set<number>> {
  const { data: teams, error: teamError } = await supabase
    .from("teams")
    .select("id")
    .eq("league_id", leagueId);

  if (teamError) throw new Error(`Failed to read teams: ${teamError.message}`);

  const teamIds = (teams ?? []).map((team) => team.id);
  if (teamIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("rosters")
    .select("player_id")
    .in("team_id", teamIds);

  if (error) throw new Error(`Failed to read rosters: ${error.message}`);
  return new Set((data ?? []).map((row) => row.player_id));
}

function marketByPlayerId(
  values: FantasyCalcPlayer[],
  players: PlayerRow[],
): { market: Map<number, FantasyCalcPlayer>; unmatched: number } {
  const bySleeperId = new Map<string, number>();
  for (const player of players) {
    if (player.sleeper_id) bySleeperId.set(player.sleeper_id, player.id);
  }

  const market = new Map<number, FantasyCalcPlayer>();
  let unmatched = 0;

  for (const value of values) {
    const playerId = value.sleeperId ? bySleeperId.get(value.sleeperId) : undefined;
    if (playerId === undefined) {
      unmatched += 1;
      continue;
    }

    // FantasyCalc lists a player once; if it ever does not, the higher value
    // is the current one.
    const existing = market.get(playerId);
    if (!existing || value.value > existing.value) market.set(playerId, value);
  }

  return { market, unmatched };
}

/**
 * How much of the season a redraft asset is still a claim on (§6). Outside the
 * regular season — preseason, or a league whose season is not the live one —
 * the whole slate is ahead, which is also what makes the preseason case fall
 * out of the same arithmetic instead of needing its own branch.
 */
function weeksRemainingFor({
  isRegularSeason,
  currentWeek,
  startWeek,
  endWeek,
}: {
  isRegularSeason: boolean;
  currentWeek: number | null;
  startWeek: number | null;
  endWeek: number | null;
}): number {
  const end = endWeek ?? SEASON_WEEKS;
  if (!isRegularSeason || currentWeek === null) {
    const start = startWeek ?? 1;
    return Math.min(SEASON_WEEKS, Math.max(1, end - start + 1));
  }

  return Math.min(SEASON_WEEKS, Math.max(1, end - currentWeek + 1));
}

/**
 * Values every player in a league's world — the market's 192, everyone on a
 * roster, and the projected free-agent pool — and writes them to
 * `player_values` with provenance.
 *
 * Idempotent, and safe to interrupt: rows are upserted under a single run
 * timestamp and only then are the leftovers from the previous run deleted, so
 * a failure part-way leaves stale values rather than no values. Phase 4 folds
 * this into sync stage 8.
 */
export async function computeLeagueValues(
  leagueId: string,
): Promise<ValuationReport> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const warnings: string[] = [];

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select(
      "id, season, num_teams, num_qbs, ppr, roster_slots, current_week, start_week, end_week",
    )
    .eq("id", leagueId)
    .single();

  if (leagueError || !league) {
    throw new Error(`League not found: ${leagueError?.message ?? leagueId}`);
  }

  const ppr = Number(league.ppr);
  const numTeams = league.num_teams ?? 12;

  await syncPlayerMaster();
  const players = await loadPlayers(admin);

  // The season clock decides two things: whether current-season actuals exist
  // at all, and how much of the season is left to be worth anything (§5, §6).
  const state = await fetchNflState();
  const liveSeason = Number(state.season);
  const isCurrentSeason = liveSeason === league.season;
  const isRegularSeason =
    isCurrentSeason && (state.season_type === "regular" || state.season_type === "post");
  const currentWeek = isRegularSeason ? state.week : null;

  const weeksRemaining = weeksRemainingFor({
    isRegularSeason,
    currentWeek,
    startWeek: league.start_week,
    endWeek: league.end_week,
  });

  const totals = await syncSeasonTotals(admin, players, {
    season: league.season,
    ppr,
    includeActuals: isRegularSeason,
  });
  warnings.push(...totals.warnings);

  const values = await fetchFantasyCalcValues({
    numQbs: league.num_qbs,
    numTeams,
    ppr,
  });
  const { market, unmatched } = marketByPlayerId(values, players);
  if (unmatched > 0) {
    warnings.push(
      `${unmatched} FantasyCalc players did not match a Sleeper id and were skipped.`,
    );
  }
  await seedFantasyCalcCrosswalkFrom(admin, players, values);

  const rostered = await rosteredPlayerIds(supabase, leagueId);

  const line = (map: Map<number, SeasonLine>, playerId: number) =>
    map.get(playerId) ?? null;

  // Scope: everyone the app can render. Anything outside it — a retired player
  // with no projection and no roster spot — has no place asking for a value.
  const candidates: EnginePlayer[] = [];
  for (const player of players) {
    const projection = line(totals.projections, player.id);
    const actual = line(totals.actuals, player.id);
    const entry = market.get(player.id) ?? null;

    const projectedPoints = projection?.points ?? null;
    const inScope =
      entry !== null ||
      rostered.has(player.id) ||
      (projectedPoints !== null && projectedPoints > 0);

    if (!inScope) continue;

    candidates.push({
      playerId: player.id,
      position: player.position,
      injuryStatus: player.injury_status,
      isRostered: rostered.has(player.id),
      projectedPoints,
      actualPoints: actual?.points ?? null,
      gamesPlayed: actual?.gamesPlayed ?? null,
      market: entry
        ? {
            value: entry.value,
            overallRank: entry.overallRank,
            positionRank: entry.positionRank,
            trend30Day: entry.trend30Day,
            tier: entry.tier,
          }
        : null,
    });
  }

  const report = computeValues(candidates, {
    numTeams,
    rosterSlots: league.roster_slots as unknown as RosterSlot[],
    weeksRemaining,
  });

  const computedAt = new Date().toISOString();
  const rows: Database["public"]["Tables"]["player_values"]["Insert"][] =
    report.rows.map((row) => ({
      player_id: row.playerId,
      league_id: leagueId,
      value: row.value,
      base_value: row.baseValue,
      value_source: row.source,
      confidence: row.confidence,
      overall_rank: row.overallRank,
      position_rank: row.positionRank,
      trend_30d: row.trend30d,
      tier: row.tier,
      computed_at: computedAt,
    }));

  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const { error } = await supabase
      .from("player_values")
      .upsert(batch, { onConflict: "player_id,league_id" });

    if (error) throw new Error(`Failed to save values: ${error.message}`);
  }

  const { error: pruneError } = await supabase
    .from("player_values")
    .delete()
    .eq("league_id", leagueId)
    .lt("computed_at", computedAt);

  if (pruneError) {
    warnings.push(`Stale values could not be cleared: ${pruneError.message}`);
  }

  const rosteredMarket = report.rows.filter(
    (row) => rostered.has(row.playerId) && row.source === "market",
  ).length;

  return {
    season: league.season,
    week: currentWeek,
    weeksRemaining,
    preseason: !isRegularSeason,
    valued: report.rows.length,
    rostered: rostered.size,
    rosteredMarket,
    bySource: report.bySource,
    overlap: report.overlap,
    rankCorrelation: report.rankCorrelation,
    seamViolations: report.seamViolations,
    marketUnmatched: unmatched,
    kdefCap: report.kdefCap,
    warnings,
  };
}

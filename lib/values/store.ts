import "server-only";

import { chunk, loadPlayers } from "@/lib/players/master";
import { loadSeasonTotals, type SeasonLine } from "@/lib/players/stats";
import type { RosterSlot } from "@/lib/sources/yahoo";
import { loadMarketValues, marketParamsKey } from "@/lib/sync/market";
import type { SyncContext } from "@/lib/sync/plan";
import type { Db } from "@/lib/supabase/db";
import type { Database } from "@/lib/supabase/database.types";

import { computeValues, type EnginePlayer, type ValueSource } from "./engine";

const INSERT_CHUNK = 500;

export type ValuationReport = {
  valued: number;
  rostered: number;
  rosteredMarket: number;
  bySource: Record<ValueSource, number>;
  overlap: number;
  rankCorrelation: number | null;
  seamViolations: number;
  kdefCap: number;
  warnings: string[];
};

async function rosteredPlayerIds(
  db: Db,
  leagueId: string,
): Promise<Set<number>> {
  const { data: teams, error: teamError } = await db
    .from("teams")
    .select("id")
    .eq("league_id", leagueId);

  if (teamError) throw new Error(`Failed to read teams: ${teamError.message}`);

  const teamIds = (teams ?? []).map((team) => team.id);
  if (teamIds.length === 0) return new Set();

  const { data, error } = await db
    .from("rosters")
    .select("player_id")
    .in("team_id", teamIds);

  if (error) throw new Error(`Failed to read rosters: ${error.message}`);
  return new Set((data ?? []).map((row) => row.player_id));
}

/**
 * Sync stage 8: values every player in a league's world — the market's 192,
 * everyone on a roster, and the projected free-agent pool — and writes them to
 * `player_values` with provenance.
 *
 * Reads only. Every external pull it depends on was made by an earlier stage
 * and committed to Postgres, which is what lets this stage be retried on its
 * own without touching Yahoo, Sleeper or FantasyCalc (§9).
 *
 * Idempotent, and safe to interrupt: rows are upserted under a single run
 * timestamp and only then are the leftovers from the previous run deleted, so
 * a failure part-way leaves stale values rather than no values.
 */
export async function computeLeagueValues(
  db: Db,
  leagueId: string,
  context: SyncContext,
): Promise<ValuationReport> {
  const warnings: string[] = [];

  const { data: league, error: leagueError } = await db
    .from("leagues")
    .select("id, season, num_teams, num_qbs, ppr, roster_slots")
    .eq("id", leagueId)
    .single();

  if (leagueError || !league) {
    throw new Error(`League not found: ${leagueError?.message ?? leagueId}`);
  }

  const ppr = Number(league.ppr);
  const numTeams = league.num_teams ?? 12;

  const [players, market, totals, rostered] = await Promise.all([
    loadPlayers(db),
    loadMarketValues(
      db,
      marketParamsKey({ numQbs: league.num_qbs, numTeams, ppr }),
    ),
    loadSeasonTotals(db, { season: league.season, ppr }),
    rosteredPlayerIds(db, leagueId),
  ]);

  if (market.size === 0) {
    warnings.push(
      "No market board for these settings — every value is modelled.",
    );
  }

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
      market: entry,
    });
  }

  const report = computeValues(candidates, {
    numTeams,
    rosterSlots: league.roster_slots as unknown as RosterSlot[],
    weeksRemaining: context.weeksRemaining,
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
      // The quantity the value was derived from, kept rather than discarded:
      // §7's needs vector and its waiver ranking are folds over projections,
      // not over prices, and re-deriving "rest of season" downstream would put
      // two definitions of it in one app.
      ros_points: row.restOfSeasonPoints,
      computed_at: computedAt,
    }));

  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const { error } = await db
      .from("player_values")
      .upsert(batch, { onConflict: "player_id,league_id" });

    if (error) throw new Error(`Failed to save values: ${error.message}`);
  }

  const { error: pruneError } = await db
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
    valued: report.rows.length,
    rostered: rostered.size,
    rosteredMarket,
    bySource: report.bySource,
    overlap: report.overlap,
    rankCorrelation: report.rankCorrelation,
    seamViolations: report.seamViolations,
    kdefCap: report.kdefCap,
    warnings,
  };
}

import "server-only";

import { seedFantasyCalcCrosswalkFrom } from "@/lib/crosswalk/store";
import { chunk, PAGE_SIZE } from "@/lib/players/master";
import { fetchFantasyCalcValues } from "@/lib/sources/fantasycalc";
import type { Db } from "@/lib/supabase/db";
import type { MarketEntry } from "@/lib/values/engine";

const UPSERT_CHUNK = 500;

export type MarketParams = { numQbs: number; numTeams: number; ppr: number };

/**
 * FantasyCalc prices a *scoring configuration*, not a league, so the board is
 * stored under the parameters it was asked for. Two leagues that score the
 * same way share one board and one fetch.
 */
export function marketParamsKey({ numQbs, numTeams, ppr }: MarketParams): string {
  return `${numQbs}qb-${numTeams}tm-${ppr}ppr`;
}

export type MarketSync = {
  paramsKey: string;
  written: number;
  /** FantasyCalc rows with no Sleeper id we recognize — a crosswalk miss. */
  unmatched: number;
  crosswalkSeeded: number;
};

/**
 * Sync stage 3: pull the trade market and persist it.
 *
 * §12's mitigation for an undocumented API, made concrete — the last good
 * board lives in Postgres, so a FantasyCalc outage costs freshness rather
 * than every value in the app. Rows are upserted under one timestamp and the
 * leftovers pruned after, so an interrupted write leaves a stale board rather
 * than a half-empty one.
 */
export async function syncMarketValues(
  db: Db,
  ids: Map<string, number>,
  params: MarketParams,
): Promise<MarketSync> {
  const paramsKey = marketParamsKey(params);
  const values = await fetchFantasyCalcValues(params);

  const fetchedAt = new Date().toISOString();
  const rows = new Map<number, {
    params_key: string;
    player_id: number;
    value: number;
    overall_rank: number;
    position_rank: number;
    trend_30d: number | null;
    tier: number | null;
    fetched_at: string;
  }>();
  let unmatched = 0;

  for (const value of values) {
    const playerId = value.sleeperId ? ids.get(value.sleeperId) : undefined;
    if (playerId === undefined) {
      unmatched += 1;
      continue;
    }

    // FantasyCalc lists a player once; if it ever does not, the higher value
    // is the current one.
    const existing = rows.get(playerId);
    if (existing && existing.value >= value.value) continue;

    rows.set(playerId, {
      params_key: paramsKey,
      player_id: playerId,
      value: value.value,
      overall_rank: value.overallRank,
      position_rank: value.positionRank,
      trend_30d: value.trend30Day,
      tier: value.tier,
      fetched_at: fetchedAt,
    });
  }

  for (const batch of chunk([...rows.values()], UPSERT_CHUNK)) {
    const { error } = await db
      .from("market_values")
      .upsert(batch, { onConflict: "params_key,player_id" });

    if (error) throw new Error(`Failed to save market values: ${error.message}`);
  }

  const { error: pruneError } = await db
    .from("market_values")
    .delete()
    .eq("params_key", paramsKey)
    .lt("fetched_at", fetchedAt);

  if (pruneError) {
    throw new Error(`Failed to prune market values: ${pruneError.message}`);
  }

  // The same pull seeds the FantasyCalc side of the crosswalk (§4) — the ids
  // are already in hand, and pulling an undocumented API twice in one run is a
  // cost with no upside.
  const crosswalkSeeded = await seedFantasyCalcCrosswalkFrom(db, ids, values);

  return { paramsKey, written: rows.size, unmatched, crosswalkSeeded };
}

/** Reads a persisted board back for the value engine. */
export async function loadMarketValues(
  db: Db,
  paramsKey: string,
): Promise<Map<number, MarketEntry>> {
  const market = new Map<number, MarketEntry>();

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("market_values")
      .select("player_id, value, overall_rank, position_rank, trend_30d, tier")
      .eq("params_key", paramsKey)
      .order("player_id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to read market values: ${error.message}`);

    for (const row of data ?? []) {
      market.set(row.player_id, {
        value: row.value,
        overallRank: row.overall_rank ?? 0,
        positionRank: row.position_rank ?? 0,
        trend30Day: row.trend_30d,
        tier: row.tier,
      });
    }

    if (!data || data.length < PAGE_SIZE) break;
  }

  return market;
}

import "server-only";

import { loadSleeperIds, syncPlayerMaster } from "@/lib/players/master";
import { marketParamsKey, syncMarketValues } from "@/lib/sync/market";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/supabase/db";
import { isTradeAsset } from "@/lib/values/engine";

import type { TradeAsset } from "./analyze";
import type { OpenScoring } from "./open-market";

/**
 * The board the open analyzer trades on (§6, without a league).
 *
 * Everything the league analyzer prices comes out of `player_values`, which is
 * keyed by league — it is the whole point of that table that a player's value
 * is computed against one league's settings and one league's rosters. A
 * visitor who has not imported a league has no such row and never will, so
 * this reads one step further up: `market_values`, which FantasyCalc prices per
 * *scoring configuration* and which two leagues that score alike already
 * share.
 *
 * What that costs is honest and worth stating plainly, because the page states
 * it too: this board is the market's ~192 players and nobody else. There is no
 * modelled tier here, because the model is calibrated per league (§5) and
 * there is no league. A player the market does not price is simply not on the
 * board — which is the same rule §4 already insists on, arrived at from the
 * other direction: a missing value is never summed as a zero, so here it is
 * never offered at all.
 */

/** One tradeable player, priced by the market and nothing else. */
export type OpenAsset = TradeAsset & {
  name: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  overallRank: number | null;
  positionRank: number | null;
  /** FantasyCalc's own 30-day drift, as a share. Context, never in the math. */
  trend30d: number | null;
};

export type OpenBoard = {
  scoring: OpenScoring;
  assets: OpenAsset[];
  /** When FantasyCalc last priced this board, or null if it never has. */
  fetchedAt: string | null;
  /**
   * A refresh was attempted and failed, so these values are the last good
   * ones. §12's mitigation, surfaced rather than swallowed: an outage costs
   * freshness, and the page says so.
   */
  stale: boolean;
};

/**
 * How old a cached board may be before this page pulls a new one.
 *
 * Shorter than the sync pipeline's cadence because nothing else refreshes this
 * board — a visitor with no league never runs a sync, so if this route does not
 * keep the board current, nobody does.
 */
const BOARD_TTL_MS = 6 * 60 * 60 * 1000;

async function readBoard(
  db: Db,
  scoring: OpenScoring,
): Promise<{ assets: OpenAsset[]; fetchedAt: string | null }> {
  const paramsKey = marketParamsKey(scoring);

  const { data: rows, error } = await db
    .from("market_values")
    .select("player_id, value, overall_rank, position_rank, trend_30d, fetched_at")
    .eq("params_key", paramsKey)
    .order("value", { ascending: false });

  if (error) throw new Error(`Failed to read the market board: ${error.message}`);
  if (!rows || rows.length === 0) return { assets: [], fetchedAt: null };

  // Two queries rather than an embedded select: `market_values` declares no
  // relationships in the generated types, and a board is ~192 rows, which is
  // one page either way.
  const { data: players, error: playerError } = await db
    .from("players")
    .select("id, full_name, position, nfl_team, injury_status")
    .in(
      "id",
      rows.map((row) => row.player_id),
    );

  if (playerError) {
    throw new Error(`Failed to read players: ${playerError.message}`);
  }

  const byId = new Map((players ?? []).map((player) => [player.id, player]));

  let fetchedAt: string | null = null;
  const assets: OpenAsset[] = [];

  for (const row of rows) {
    const player = byId.get(row.player_id);
    // A market row whose player has been deleted from the master is a name we
    // cannot print. It is dropped, not rendered as an id.
    if (!player) continue;

    // §3: kickers and defenses are streamed, not traded. FantasyCalc does not
    // price them at all, so this is belt and braces — but the analyzer's own
    // rule should not depend on a third party continuing to agree with it.
    if (!isTradeAsset(player.position)) continue;

    if (fetchedAt === null || row.fetched_at > fetchedAt) {
      fetchedAt = row.fetched_at;
    }

    assets.push({
      playerId: player.id,
      name: player.full_name,
      position: player.position,
      nflTeam: player.nfl_team,
      injuryStatus: player.injury_status,
      value: row.value,
      // Every row on this board came from FantasyCalc. Nothing here is
      // modelled, so nothing here may claim to be anything else.
      source: "market",
      overallRank: row.overall_rank,
      positionRank: row.position_rank,
      trend30d: row.trend_30d === null ? null : Number(row.trend_30d),
    });
  }

  return { assets, fetchedAt };
}

/**
 * How old the cached board for a params key is, in milliseconds, or `Infinity`
 * if there is none.
 *
 * One row, asked separately from the board itself — and it has to be a
 * separate question rather than a length check on a board already in hand,
 * because of the next function's constraint.
 */
async function boardAge(db: Db, paramsKey: string): Promise<number> {
  const { data, error } = await db
    .from("market_values")
    .select("fetched_at")
    .eq("params_key", paramsKey)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to read the market board: ${error.message}`);
  if (!data) return Infinity;

  return Date.now() - Date.parse(data.fetched_at);
}

/**
 * Loads the board for a scoring configuration, pulling a fresh one first when
 * the cache is missing or stale.
 *
 * **The board is read exactly once, after any refresh.** Reading it, refreshing
 * on a miss and reading again is the obvious shape and it does not work: React
 * memoizes identical `fetch` calls within one render pass, so the second read —
 * byte-identical to the first — is answered from the first one's response and
 * the rows just written are invisible. Asking the freshness question first, as
 * a different query, keeps the one read that matters honest.
 *
 * Reads with the service role. `market_values` and `players` are global
 * reference data readable by every signed-in user already (§8), and this route
 * is deliberately reachable without an account — so the alternative would be
 * granting the anon role a policy on both tables, which widens what an
 * unauthenticated request can reach far beyond the one page that needs it.
 *
 * A refresh failure is not an error here. The last good board in Postgres is
 * exactly what §12 keeps it for, and a stale verdict with a date on it beats an
 * empty screen.
 */
export async function loadOpenBoard(scoring: OpenScoring): Promise<OpenBoard> {
  const db = createAdminClient();
  const paramsKey = marketParamsKey(scoring);

  const age = await boardAge(db, paramsKey);
  let stale = false;

  if (age >= BOARD_TTL_MS) {
    try {
      // FantasyCalc identifies players by Sleeper id, so the master has to
      // exist before a pull can be matched to anybody. On a database that has
      // never run a sync this is the 14.6 MB pull (§3); on every other request
      // it is one row read and a TTL check.
      let ids = await loadSleeperIds(db);
      if (ids.size === 0) {
        await syncPlayerMaster(db);
        ids = await loadSleeperIds(db);
      }

      await syncMarketValues(db, ids, scoring);
    } catch (cause) {
      // Swallowed for the page's sake, not for the operator's: a board that
      // silently stops refreshing looks identical to one nobody is visiting.
      console.error(`Open board refresh failed for ${paramsKey}:`, cause);
      stale = Number.isFinite(age);
    }
  }

  const { assets, fetchedAt } = await readBoard(db, scoring);

  return {
    scoring,
    assets,
    fetchedAt,
    // Nothing was cached and the refresh failed: the page has no board to be
    // stale about, and says *that* instead.
    stale: stale && assets.length > 0,
  };
}

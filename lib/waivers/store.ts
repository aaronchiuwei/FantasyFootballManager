import "server-only";

import { loadNeedsByTeam } from "@/lib/needs/store";
import type { Db } from "@/lib/supabase/db";
import { isValueSource, type ValueSource } from "@/lib/values/engine";

import { DEFAULT_LAMBDA, LAMBDA_LIMITS } from "./score";

/**
 * The waiver screen's one read, and the one knob it persists (§7, §8).
 *
 * The ranking itself lives next door in `./score` and never touches this file:
 * the λ slider re-orders the board in the browser, exactly the way §6's knobs
 * re-price a trade, so the server is asked for the pool once and for λ when it
 * is released.
 */

/**
 * How much of Yahoo's available list is worth ranking.
 *
 * §3 already caps the pagination at the top ~150 free agents Yahoo ranks,
 * which is "far more than any waiver recommendation needs"; this is only a
 * guard against a pool that grew.
 */
const POOL_LIMIT = 250;

export type WaiverPlayer = {
  playerId: number;
  name: string;
  position: string | null;
  nflTeam: string | null;
  injuryStatus: string | null;
  /** Sleeper's portrait, already resolved on the player master. */
  headshotUrl: string | null;
  /** §7: shown for continuity with the rest of the app, never the ordering. */
  value: number;
  source: ValueSource;
  rosPoints: number | null;
  /** The season projection, for the row that wants a familiar number. */
  projectedPoints: number | null;
};

export type WaiverTeam = {
  id: string;
  name: string;
  isUsersTeam: boolean;
  /** `need` by position, the §7 score's second input. */
  needs: Record<string, number>;
};

export type WaiverBoard = {
  teams: WaiverTeam[];
  players: WaiverPlayer[];
  lambda: number;
  computedAt: string | null;
  fetchedAt: string | null;
  /** True once a needs vector exists; until then every multiplier is 1. */
  hasNeeds: boolean;
};

function clampLambda(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LAMBDA;
  return Math.min(LAMBDA_LIMITS.max, Math.max(LAMBDA_LIMITS.min, value));
}

/**
 * A league with no settings row is a league on §7's default, not an error —
 * the row is written the first time someone moves the slider, exactly as the
 * trade knobs are.
 */
export async function loadWaiverLambda(db: Db, leagueId: string): Promise<number> {
  const { data } = await db
    .from("league_settings")
    .select("lambda")
    .eq("league_id", leagueId)
    .maybeSingle();

  return data ? clampLambda(Number(data.lambda)) : DEFAULT_LAMBDA;
}

export async function saveWaiverLambda(
  db: Db,
  leagueId: string,
  lambda: number,
): Promise<number> {
  const next = clampLambda(lambda);

  const { error } = await db
    .from("league_settings")
    .upsert({ league_id: leagueId, lambda: next }, { onConflict: "league_id" });

  if (error) throw new Error(`Could not save the need weight: ${error.message}`);
  return next;
}

/**
 * Everything the waiver screen needs, in one trip.
 *
 * The pool is `league_free_agents` — Yahoo's own available list, resolved
 * through §4's ladder and priced by §5 — rather than "every valued player not
 * on a roster". Those are different claims: `player_values` prices roughly six
 * hundred players, most of whom Yahoo has never offered in any league, and a
 * recommendation you cannot act on is not a recommendation.
 */
export async function loadWaiverBoard(
  db: Db,
  leagueId: string,
): Promise<WaiverBoard> {
  const [{ data: teams, error: teamError }, { data: rows, error }, lambda] =
    await Promise.all([
      db
        .from("teams")
        .select("id, name, is_users_team")
        .eq("league_id", leagueId)
        .order("is_users_team", { ascending: false })
        .order("name"),
      db
        .from("league_free_agents")
        .select(
          "player_id, full_name, position, nfl_team, injury_status, headshot_url, value, value_source, ros_points, projected_pts_ppr, computed_at, fetched_at",
        )
        .eq("league_id", leagueId)
        // §7 ranks on rest-of-season projection, so the cut is made on the same
        // quantity the ranking uses — a limit applied on any other order would
        // decide the board before the score did.
        .order("ros_points", { ascending: false, nullsFirst: false })
        .limit(POOL_LIMIT),
      loadWaiverLambda(db, leagueId),
    ]);

  if (teamError) throw new Error(`Failed to read teams: ${teamError.message}`);
  if (error) throw new Error(`Failed to read free agents: ${error.message}`);

  const teamIds = (teams ?? []).map((team) => team.id);
  const needs = await loadNeedsByTeam(db, teamIds);

  let computedAt: string | null = null;
  let fetchedAt: string | null = null;

  const players: WaiverPlayer[] = (rows ?? []).map((row) => {
    if (computedAt === null || row.computed_at > computedAt) {
      computedAt = row.computed_at;
    }
    if (fetchedAt === null || row.fetched_at > fetchedAt) {
      fetchedAt = row.fetched_at;
    }

    return {
      playerId: row.player_id,
      name: row.full_name,
      position: row.position,
      nflTeam: row.nfl_team,
      injuryStatus: row.injury_status,
      headshotUrl: row.headshot_url,
      value: row.value,
      // A source the enum does not know is a value we cannot vouch for; the
      // badge says "unvalued" rather than implying a price (§5).
      source: isValueSource(row.value_source) ? row.value_source : "floor",
      rosPoints: row.ros_points === null ? null : Number(row.ros_points),
      projectedPoints:
        row.projected_pts_ppr === null ? null : Number(row.projected_pts_ppr),
    };
  });

  return {
    teams: (teams ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      isUsersTeam: team.is_users_team,
      needs: Object.fromEntries(needs.get(team.id) ?? []),
    })),
    players,
    lambda,
    computedAt,
    fetchedAt,
    hasNeeds: needs.size > 0,
  };
}

import "server-only";

import type { RosterSlot } from "@/lib/sources/yahoo";
import type { Db } from "@/lib/supabase/db";
import type { Database } from "@/lib/supabase/database.types";

import {
  computeNeeds,
  isNeedPosition,
  NEED_POSITIONS,
  type NeedPosition,
  type NeedsPlayer,
  type NeedsRoster,
  type TeamNeed,
} from "./needs";

/**
 * The needs vector's persistence (§7, §8, §9 stage 8).
 *
 * The math lives next door in `./needs` and never touches this file. What
 * happens here is the part §9 gives to a sync stage: fold every roster in the
 * league into one structure, write it down, and hand it to the screens that
 * read it. §7 computes it "once per sync and caches" it because it is a fold
 * over the whole league — nothing about it is per-request.
 *
 * Takes a `Db` rather than making one, like every other data-access module: the
 * sync pipeline calls it with the service role, and the pages call it with the
 * user's RLS-bound client.
 */

export type NeedsRun = {
  teams: number;
  rows: number;
  /** Rostered players with no projection to fold in — the vector's blind spot. */
  unprojected: number;
  /** `k_p` per position, from the league's own starting slots. */
  starters: Record<NeedPosition, number>;
  warnings: string[];
};

type NeedsInsert = Database["public"]["Tables"]["team_needs"]["Insert"];

/**
 * Sync stage 8's second half: the §7 needs vector over the values its first
 * half just computed.
 *
 * Reads only, like the valuation before it — every external pull it depends on
 * was made by an earlier stage and committed, which is what lets stage 8 be
 * retried on its own without touching Yahoo, Sleeper or FantasyCalc.
 *
 * Rest-of-season points come off `player_values.ros_points` rather than being
 * recomputed: that column is §5's blend, already scaled to the weeks that are
 * left, and the whole point of storing it was that the needs vector and the
 * value it produced should be talking about the same season.
 */
export async function computeTeamNeeds(
  db: Db,
  leagueId: string,
): Promise<NeedsRun> {
  const warnings: string[] = [];

  const [{ data: league, error: leagueError }, { data: teams, error: teamError }] =
    await Promise.all([
      db
        .from("leagues")
        .select("id, roster_slots")
        .eq("id", leagueId)
        .single(),
      db.from("teams").select("id").eq("league_id", leagueId),
    ]);

  if (leagueError || !league) {
    throw new Error(`League not found: ${leagueError?.message ?? leagueId}`);
  }
  if (teamError) throw new Error(`Failed to read teams: ${teamError.message}`);

  const teamIds = (teams ?? []).map((team) => team.id);
  if (teamIds.length === 0) {
    return {
      teams: 0,
      rows: 0,
      unprojected: 0,
      starters: emptyStarters(),
      warnings: ["No teams to read — run a sync that reaches Yahoo first."],
    };
  }

  const { data: rows, error } = await db
    .from("league_player_values")
    .select("player_id, position, ros_points, team_id")
    .eq("league_id", leagueId)
    .not("team_id", "is", null);

  if (error) throw new Error(`Failed to read rosters: ${error.message}`);

  const byTeam = new Map<string, NeedsPlayer[]>(
    // Every team gets a roster, including one whose players all failed to
    // resolve: an empty roster is twelve maximal needs, which is true and
    // visible, where a missing team would silently shrink the league the
    // z-scores are measured against.
    teamIds.map((teamId) => [teamId, [] as NeedsPlayer[]]),
  );

  for (const row of rows ?? []) {
    if (!row.team_id) continue;
    const roster = byTeam.get(row.team_id);
    if (!roster) continue;

    roster.push({
      playerId: row.player_id,
      position: row.position,
      // Postgres numerics arrive as strings often enough to be worth the cast.
      points: row.ros_points === null ? null : Number(row.ros_points),
    });
  }

  const rosters: NeedsRoster[] = [...byTeam].map(([teamId, players]) => ({
    teamId,
    players,
  }));

  const report = computeNeeds(
    rosters,
    league.roster_slots as unknown as RosterSlot[],
  );

  const computedAt = new Date().toISOString();
  const inserts: NeedsInsert[] = report.rows.map((row) => ({
    team_id: row.teamId,
    position: row.position,
    strength: round(row.strength),
    z_score: round(row.zScore),
    need: round(row.need),
    surplus: round(row.surplus),
    surplus_z: round(row.surplusZ),
    confidence: round(row.confidence),
    computed_at: computedAt,
  }));

  const { error: writeError } = await db
    .from("team_needs")
    .upsert(inserts, { onConflict: "team_id,position" });

  if (writeError) {
    throw new Error(`Failed to save needs: ${writeError.message}`);
  }

  // Same shape as the valuation's prune: rows are written under one run
  // timestamp and only then are the leftovers cleared, so an interrupted stage
  // leaves a stale vector rather than none. A team dropped from the league
  // takes its rows with it through the foreign key.
  const { error: pruneError } = await db
    .from("team_needs")
    .delete()
    .in("team_id", teamIds)
    .lt("computed_at", computedAt);

  if (pruneError) {
    warnings.push(`Stale needs could not be cleared: ${pruneError.message}`);
  }

  const rostered = (rows ?? []).length;
  if (rostered > 0 && report.unprojected / rostered > 0.1) {
    warnings.push(
      `${report.unprojected} of ${rostered} rostered players have no projection, so the needs vector understates their teams.`,
    );
  }

  return {
    teams: rosters.length,
    rows: inserts.length,
    unprojected: report.unprojected,
    starters: report.starters,
    warnings,
  };
}

function emptyStarters(): Record<NeedPosition, number> {
  return Object.fromEntries(
    NEED_POSITIONS.map((position) => [position, 0]),
  ) as Record<NeedPosition, number>;
}

/** Two decimals is well past what any surface renders, and keeps the row small. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// reading it back
// ---------------------------------------------------------------------------

export type TeamNeedsRow = TeamNeed;

export type LeagueNeedsTeam = {
  id: string;
  name: string;
  managerName: string | null;
  logoUrl: string | null;
  isUsersTeam: boolean;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  needs: TeamNeedsRow[];
};

export type LeagueNeeds = {
  teams: LeagueNeedsTeam[];
  computedAt: string | null;
  /** Rostered players the crosswalk could not resolve, so no roster holds them. */
  unresolved: number;
};

function toNeed(row: {
  team_id: string;
  position: string;
  strength: number;
  z_score: number;
  need: number;
  surplus: number;
  surplus_z: number;
  confidence: number;
}): TeamNeedsRow | null {
  // A position this build does not know is not a position. Postgres has a
  // check constraint saying the same thing; this narrows the type honestly
  // rather than casting past it.
  if (!isNeedPosition(row.position)) return null;

  return {
    teamId: row.team_id,
    position: row.position,
    strength: Number(row.strength),
    zScore: Number(row.z_score),
    need: Number(row.need),
    surplus: Number(row.surplus),
    surplusZ: Number(row.surplus_z),
    confidence: Number(row.confidence),
    // Not persisted: the count is only interesting while the vector is being
    // built, and `confidence` is the durable form of the same fact.
    unprojected: 0,
  };
}

/** Everything §10's overview grid renders, in two reads. */
export async function loadLeagueNeeds(
  db: Db,
  leagueId: string,
): Promise<LeagueNeeds> {
  const [{ data: teams, error: teamError }, { count: unresolved }] =
    await Promise.all([
      db
        .from("teams")
        .select(
          "id, name, manager_name, logo_url, is_users_team, rank, wins, losses, ties",
        )
        .eq("league_id", leagueId)
        .order("rank", { ascending: true, nullsFirst: false }),
      db
        .from("unmatched_players")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .is("resolved_at", null),
    ]);

  if (teamError) throw new Error(`Failed to read teams: ${teamError.message}`);

  const teamIds = (teams ?? []).map((team) => team.id);
  if (teamIds.length === 0) {
    return { teams: [], computedAt: null, unresolved: unresolved ?? 0 };
  }

  const { data: rows, error } = await db
    .from("team_needs")
    .select(
      "team_id, position, strength, z_score, need, surplus, surplus_z, confidence, computed_at",
    )
    .in("team_id", teamIds);

  if (error) throw new Error(`Failed to read needs: ${error.message}`);

  const byTeam = new Map<string, TeamNeedsRow[]>();
  let computedAt: string | null = null;

  for (const row of rows ?? []) {
    const need = toNeed(row);
    if (!need) continue;

    if (computedAt === null || row.computed_at > computedAt) {
      computedAt = row.computed_at;
    }

    const list = byTeam.get(row.team_id);
    if (list) list.push(need);
    else byTeam.set(row.team_id, [need]);
  }

  return {
    teams: (teams ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      managerName: team.manager_name,
      logoUrl: team.logo_url,
      isUsersTeam: team.is_users_team,
      rank: team.rank,
      wins: team.wins,
      losses: team.losses,
      ties: team.ties,
      needs: byTeam.get(team.id) ?? [],
    })),
    computedAt,
    unresolved: unresolved ?? 0,
  };
}

/**
 * `need` by position, per team — the shape §7's waiver score and the trade
 * page's roster-context panel both want, and nothing more than that.
 */
export async function loadNeedsByTeam(
  db: Db,
  teamIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const needs = new Map<string, Map<string, number>>();
  if (teamIds.length === 0) return needs;

  const { data, error } = await db
    .from("team_needs")
    .select("team_id, position, need")
    .in("team_id", teamIds);

  if (error) throw new Error(`Failed to read needs: ${error.message}`);

  for (const row of data ?? []) {
    const byPosition = needs.get(row.team_id) ?? new Map<string, number>();
    byPosition.set(row.position, Number(row.need));
    needs.set(row.team_id, byPosition);
  }

  return needs;
}

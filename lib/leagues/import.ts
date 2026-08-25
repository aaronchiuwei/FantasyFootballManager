import "server-only";

import { fetchLeague } from "@/lib/sources/yahoo";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

export type ImportResult = {
  leagueId: string;
  leagueName: string;
  teamCount: number;
};

/**
 * Pulls a league from Yahoo and writes it to Postgres.
 *
 * Deliberately uses the user's RLS-bound client rather than the service role:
 * league and team rows are user data, so the policies should be doing the work
 * on every write. Only the token read underneath is privileged.
 *
 * Idempotent — re-importing refreshes the same rows, which is what Phase 4's
 * sync stage 6 will call.
 */
export async function importLeague(
  userId: string,
  leagueKey: string,
): Promise<ImportResult> {
  const { league, teams } = await fetchLeague(userId, leagueKey);
  const supabase = await createClient();

  const { data: leagueRow, error: leagueError } = await supabase
    .from("leagues")
    .upsert(
      {
        user_id: userId,
        yahoo_league_key: league.leagueKey,
        yahoo_game_key: league.gameKey,
        name: league.name,
        season: league.season,
        num_teams: league.numTeams,
        scoring_type: league.scoringType,
        ppr: league.ppr,
        num_qbs: league.numQbs,
        roster_slots: league.rosterSlots as unknown as Json,
        is_dynasty: league.isDynasty,
        current_week: league.currentWeek,
        start_week: league.startWeek,
        end_week: league.endWeek,
        logo_url: league.logoUrl,
        url: league.url,
        is_finished: league.isFinished,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,yahoo_league_key" },
    )
    .select("id, name")
    .single();

  if (leagueError || !leagueRow) {
    throw new Error(`Failed to save league: ${leagueError?.message}`);
  }

  if (teams.length > 0) {
    const { error: teamsError } = await supabase.from("teams").upsert(
      teams.map((team) => ({
        league_id: leagueRow.id,
        yahoo_team_key: team.teamKey,
        yahoo_team_id: team.teamId,
        name: team.name,
        manager_name: team.managerName,
        logo_url: team.logoUrl,
        is_users_team: team.isUsersTeam,
        wins: team.wins,
        losses: team.losses,
        ties: team.ties,
        points_for: team.pointsFor,
        points_against: team.pointsAgainst,
        rank: team.rank,
        playoff_seed: team.playoffSeed,
        waiver_priority: team.waiverPriority,
        faab_balance: team.faabBalance,
        number_of_moves: team.numberOfMoves,
        number_of_trades: team.numberOfTrades,
      })),
      { onConflict: "league_id,yahoo_team_key" },
    );

    if (teamsError) {
      throw new Error(`Failed to save teams: ${teamsError.message}`);
    }

    // A team that vanished from Yahoo (folded, or the league was rebuilt)
    // should not linger as a ghost row.
    const { error: pruneError } = await supabase
      .from("teams")
      .delete()
      .eq("league_id", leagueRow.id)
      .not(
        "yahoo_team_key",
        "in",
        `(${teams.map((team) => `"${team.teamKey}"`).join(",")})`,
      );

    if (pruneError) {
      throw new Error(`Failed to prune stale teams: ${pruneError.message}`);
    }
  }

  return {
    leagueId: leagueRow.id,
    leagueName: leagueRow.name,
    teamCount: teams.length,
  };
}

import "server-only";

import {
  fetchLeague,
  type LeagueImport,
  type MatchupImport,
  type TeamImport,
} from "@/lib/sources/yahoo";
import type { Db } from "@/lib/supabase/db";
import type { Json } from "@/lib/supabase/database.types";

export type ImportResult = {
  leagueId: string;
  leagueName: string;
  teamCount: number;
};

export type SaveLeagueOptions = {
  /** `leagues.source`: which provider these rows were read from. */
  source: "yahoo" | "espn";
  /**
   * Whether the payload could say which team is the user's.
   *
   * Yahoo always can — the request was made as them. ESPN can only when the
   * league was read with the user's cookies, and a public league read without
   * them cannot. False leaves `is_users_team` out of the write entirely, so an
   * upsert refreshes everything else about a team without stepping on a choice
   * the user made on the board.
   */
  writeUsersTeam: boolean;
};

/**
 * Writes a league and its teams to Postgres, whoever fetched them.
 *
 * The client is passed in rather than created here. Interactively — importing
 * a league you just picked — that is the user's RLS-bound client, so the
 * policies do the work on every write. Inside the sync pipeline there is no
 * cookie session to bind to, so it is the service role, scoped by the league
 * id on the run row that an authenticated owner created (§9).
 *
 * Idempotent — re-importing refreshes the same rows, which is what sync stage
 * 6 relies on.
 */
export async function saveLeague(
  db: Db,
  userId: string,
  { league, teams }: { league: LeagueImport; teams: TeamImport[] },
  { source, writeUsersTeam }: SaveLeagueOptions,
): Promise<ImportResult> {
  // A league the user renamed keeps its name. The provider is the authority on
  // what a league is called right up until a human disagrees, and overwriting
  // their choice on every sync would make the rename look like it worked and
  // then quietly undo it.
  const { data: existing } = await db
    .from("leagues")
    .select("name, name_overridden")
    .eq("user_id", userId)
    .eq("yahoo_league_key", league.leagueKey)
    .maybeSingle();

  const name =
    existing?.name_overridden && existing.name ? existing.name : league.name;

  const { data: leagueRow, error: leagueError } = await db
    .from("leagues")
    .upsert(
      {
        user_id: userId,
        source,
        yahoo_league_key: league.leagueKey,
        yahoo_game_key: league.gameKey,
        name,
        // Recorded on every sync, override or not: a reset should restore what
        // the provider calls the league *now*, not what it called it when the
        // user first renamed it.
        provider_name: league.name,
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
    const { error: teamsError } = await db.from("teams").upsert(
      teams.map((team) => ({
        league_id: leagueRow.id,
        yahoo_team_key: team.teamKey,
        yahoo_team_id: team.teamId,
        name: team.name,
        manager_name: team.managerName,
        logo_url: team.logoUrl,
        ...(writeUsersTeam ? { is_users_team: team.isUsersTeam } : {}),
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

    // A team that vanished from the provider (folded, or the league was
    // rebuilt) should not linger as a ghost row.
    const { error: pruneError } = await db
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

/**
 * Pulls a league from Yahoo and writes it. The Yahoo half of §1.2, unchanged
 * apart from now naming the source it is.
 */
export async function importLeague(
  db: Db,
  userId: string,
  leagueKey: string,
): Promise<ImportResult> {
  return saveLeague(db, userId, await fetchLeague(userId, leagueKey), {
    source: "yahoo",
    writeUsersTeam: true,
  });
}

/** Maps a provider's team keys onto our uuids for a league. */
export async function teamIdsByKey(
  db: Db,
  leagueId: string,
): Promise<Map<string, string>> {
  const { data, error } = await db
    .from("teams")
    .select("id, yahoo_team_key")
    .eq("league_id", leagueId);

  if (error) throw new Error(`Failed to read teams: ${error.message}`);
  return new Map((data ?? []).map((team) => [team.yahoo_team_key, team.id]));
}

/**
 * Writes the schedule. Matchups are keyed by our team ids, so a matchup whose
 * teams have not been imported yet is dropped rather than written against a
 * dangling key — the same pull writes both, so that only happens if Yahoo
 * reports a team in the scoreboard that it left out of the standings.
 */
export async function saveMatchups(
  db: Db,
  leagueId: string,
  matchups: MatchupImport[],
): Promise<number> {
  if (matchups.length === 0) return 0;

  const teamIds = await teamIdsByKey(db, leagueId);

  const rows = matchups.flatMap((matchup) => {
    const teamA = teamIds.get(matchup.teamKeyA);
    if (!teamA) return [];

    return [
      {
        league_id: leagueId,
        week: matchup.week,
        team_a: teamA,
        team_b: matchup.teamKeyB
          ? (teamIds.get(matchup.teamKeyB) ?? null)
          : null,
        points_a: matchup.pointsA,
        points_b: matchup.pointsB,
        projected_a: matchup.projectedA,
        projected_b: matchup.projectedB,
        status: matchup.status,
        is_playoffs: matchup.isPlayoffs,
      },
    ];
  });

  if (rows.length === 0) return 0;

  const { error } = await db
    .from("matchups")
    .upsert(rows, { onConflict: "league_id,week,team_a" });

  if (error) throw new Error(`Failed to save matchups: ${error.message}`);
  return rows.length;
}

import "server-only";

import type { Db } from "@/lib/supabase/db";

/**
 * Moves the "my team" flag, for any kind of league.
 *
 * Exclusive by construction: the whole league is cleared first, because two
 * teams claiming to be yours makes every "my team" filter in the app pick one
 * arbitrarily.
 *
 * No source check lives here. Who is allowed to move the flag is a question
 * each caller answers — a manual league gates on `requireManualLeague`, an
 * ESPN one on the league having no owner ESPN could name — and RLS is what
 * makes either of those safe rather than merely tidy.
 */
export async function setUsersTeam(
  db: Db,
  leagueId: string,
  teamId: string,
): Promise<void> {
  const { error: clearError } = await db
    .from("teams")
    .update({ is_users_team: false })
    .eq("league_id", leagueId)
    .neq("id", teamId);

  if (clearError) {
    throw new Error(`Could not move the flag: ${clearError.message}`);
  }

  const { error } = await db
    .from("teams")
    .update({ is_users_team: true })
    .eq("id", teamId)
    .eq("league_id", leagueId);

  if (error) throw new Error(`Could not set your team: ${error.message}`);
}

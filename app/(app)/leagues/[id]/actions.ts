"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isEspnLeague } from "@/lib/leagues/espn";
import { setUsersTeam } from "@/lib/leagues/my-team";
import { createClient } from "@/lib/supabase/server";

export type ClaimTeamResult = { error?: string };

/**
 * Claims a team on a league nobody could claim it for.
 *
 * ESPN only names an owner when the league was read with that owner's cookies,
 * so a public league arrives with twelve teams and no point of view. Every
 * "my team" filter in the app reads that flag, which makes this the one thing
 * such a board is missing — and one click is a better answer than demanding a
 * cookie paste for a league that does not otherwise need one.
 *
 * Restricted to ESPN leagues on purpose. A Yahoo league is told whose team is
 * whose by Yahoo on every sync, so a choice made here would be overwritten by
 * the next one; a manual league has the manage screen for this.
 */
export async function claimEspnTeamAction(
  leagueId: string,
  teamId: string,
): Promise<ClaimTeamResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}`)}`);

  const { data: league } = await supabase
    .from("leagues")
    .select("id, source")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) return { error: "That league does not exist." };
  if (!isEspnLeague(league.source)) {
    return { error: "This league's owner is read from the provider." };
  }

  try {
    await setUsersTeam(supabase, leagueId, teamId);
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "Something went wrong.",
    };
  }

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath("/leagues");
  return {};
}

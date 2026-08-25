"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  applyOverride,
  resolveLeagueIdentities,
  type ResolutionReport,
} from "@/lib/crosswalk/store";
import { YahooReauthRequired } from "@/lib/sources/yahoo-auth";
import { createClient } from "@/lib/supabase/server";

export type ResolveResult = { error?: string; report?: ResolutionReport };

async function requireUser(leagueId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}/identity`)}`);
  }
  return user;
}

function describe(cause: unknown) {
  if (cause instanceof YahooReauthRequired) {
    return "Your Yahoo link expired. Reconnect Yahoo and try again.";
  }
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * Runs the crosswalk over the league's rosters and free agents. Phase 4 folds
 * this into sync stages 2 and 7; for now it is its own button.
 */
export async function resolveIdentitiesAction(
  leagueId: string,
): Promise<ResolveResult> {
  const user = await requireUser(leagueId);

  let report: ResolutionReport;
  try {
    report = await resolveLeagueIdentities(user.id, leagueId);
  } catch (cause) {
    return { error: describe(cause) };
  }

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/identity`);
  return { report };
}

/** The admin UI's one-click "these are the same person" (§4). */
export async function resolveUnmatchedAction(
  leagueId: string,
  unmatchedId: string,
  playerId: number,
): Promise<{ error?: string; name?: string }> {
  const user = await requireUser(leagueId);

  try {
    const { name } = await applyOverride(user.id, {
      leagueId,
      unmatchedId,
      playerId,
    });

    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath(`/leagues/${leagueId}/identity`);
    return { name };
  } catch (cause) {
    return { error: describe(cause) };
  }
}

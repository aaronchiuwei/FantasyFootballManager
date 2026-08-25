"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { applyOverride } from "@/lib/crosswalk/store";
import { YahooReauthRequired } from "@/lib/sources/yahoo-auth";
import { createClient } from "@/lib/supabase/server";

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

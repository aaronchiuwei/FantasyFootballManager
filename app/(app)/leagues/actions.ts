"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { importLeague } from "@/lib/leagues/import";
import { disconnectYahoo, YahooReauthRequired } from "@/lib/sources/yahoo-auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error?: string };

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=%2Fleagues");
  return user;
}

function describe(cause: unknown) {
  if (cause instanceof YahooReauthRequired) {
    return "Your Yahoo link expired. Reconnect Yahoo and try again.";
  }
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * Imports a league from Yahoo, then lands on its page.
 *
 * Only the league and its teams — rosters, values and everything else arrive
 * with the first sync, which is the button waiting on the other side of the
 * redirect. Written with the user's own client so RLS authorizes the writes.
 */
export async function importLeagueAction(
  leagueKey: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();

  let leagueId: string;
  try {
    ({ leagueId } = await importLeague(supabase, user.id, leagueKey));
  } catch (cause) {
    return { error: describe(cause) };
  }

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  redirect(`/leagues/${leagueId}`);
}

export async function disconnectYahooAction() {
  const user = await requireUser();
  await disconnectYahoo(user.id);

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
}

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

/** Imports a league from Yahoo, then lands on its page. */
export async function importLeagueAction(
  leagueKey: string,
): Promise<ActionResult> {
  const user = await requireUser();

  let leagueId: string;
  try {
    ({ leagueId } = await importLeague(user.id, leagueKey));
  } catch (cause) {
    return { error: describe(cause) };
  }

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  redirect(`/leagues/${leagueId}`);
}

/** Re-pulls an already-imported league. Phase 4 folds this into the sync. */
export async function refreshLeagueAction(
  leagueId: string,
  leagueKey: string,
): Promise<ActionResult> {
  const user = await requireUser();

  try {
    await importLeague(user.id, leagueKey);
  } catch (cause) {
    return { error: describe(cause) };
  }

  revalidatePath(`/leagues/${leagueId}`);
  return {};
}

export async function disconnectYahooAction() {
  const user = await requireUser();
  await disconnectYahoo(user.id);

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
}

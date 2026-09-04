"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";

import { importLeague } from "@/lib/leagues/import";
import { startInitialSync } from "@/lib/sync/auto";
import { kickStage } from "@/lib/sync/pipeline";
import { disconnectEspn } from "@/lib/sources/espn-auth";
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
 * The import writes only the league and its teams; rosters, values and
 * everything else arrive with a sync, which is started here rather than left
 * as a button on the other side of the redirect. A board that opens on "no
 * values yet" reads as broken rather than new.
 *
 * Written with the user's own client so RLS authorizes the writes.
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

  const pending = await startInitialSync(supabase, user.id, leagueId);
  if (pending) after(() => kickStage(pending.runId, pending.stageId));

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  redirect(`/leagues/${leagueId}`);
}

/** Length past which a league name stops being a name. */
const MAX_NAME = 120;

/**
 * Renames a league, and records that a human chose the name.
 *
 * The flag is the whole point. `saveLeague` writes `name` from the provider on
 * every sync, so without it a rename would hold until the next one and then
 * revert with nothing to explain why.
 */
export async function renameLeagueAction(
  leagueId: string,
  rawName: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const name = rawName.trim().replace(/\s+/g, " ");
  if (name === "") return { error: "Give the league a name." };
  if (name.length > MAX_NAME) {
    return { error: `That name is longer than ${MAX_NAME} characters.` };
  }

  const { error } = await supabase
    .from("leagues")
    .update({ name, name_overridden: true })
    .eq("id", leagueId)
    .eq("user_id", user.id);

  if (error) return { error: `Could not rename the league: ${error.message}` };

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  revalidatePath(`/leagues/${leagueId}`);
  return {};
}

/**
 * Hands the league's name back to the provider.
 *
 * Clearing the flag is the substantive half: it puts `saveLeague` back in
 * charge, so the name tracks the provider from here on rather than freezing at
 * whatever it happens to be today. Writing `provider_name` into `name` at the
 * same time is what makes the change visible before the next sync — without
 * it the row would keep the old custom name until something else refreshed it,
 * which reads as the button having done nothing.
 */
export async function resetLeagueNameAction(
  leagueId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: league, error: readError } = await supabase
    .from("leagues")
    .select("provider_name")
    .eq("id", leagueId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (readError) {
    return { error: `Could not read the league: ${readError.message}` };
  }
  if (!league) return { error: "That league does not exist." };
  if (!league.provider_name) {
    // A manual league has no provider to defer to, so there is no name to go
    // back to — its name has only ever been the one someone typed.
    return { error: "This league was not imported, so it has no provider name." };
  }

  const { error } = await supabase
    .from("leagues")
    .update({ name: league.provider_name, name_overridden: false })
    .eq("id", leagueId)
    .eq("user_id", user.id);

  if (error) return { error: `Could not reset the name: ${error.message}` };

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  revalidatePath(`/leagues/${leagueId}`);
  return {};
}

/**
 * Deletes a league and everything computed from it.
 *
 * Every child table references `leagues (id) on delete cascade`, so this one
 * statement takes the teams, rosters, values, needs, suggestions, move history
 * and sync runs with it. That is the intent, and it is why the control that
 * calls this asks twice: there is no undo, and a re-import would rebuild the
 * board but not a hand-kept league's rosters.
 */
export async function deleteLeagueAction(
  leagueId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("leagues")
    .delete()
    .eq("id", leagueId)
    .eq("user_id", user.id);

  if (error) return { error: `Could not delete the league: ${error.message}` };

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  return {};
}

export async function disconnectYahooAction() {
  const user = await requireUser();
  await disconnectYahoo(user.id);

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  revalidatePath("/account");
}

/**
 * Forgets the stored ESPN cookies.
 *
 * Public ESPN leagues keep syncing afterwards — they never needed a login —
 * so this is narrower than disconnecting Yahoo: it removes a credential, not
 * an account link.
 */
export async function disconnectEspnAction() {
  const user = await requireUser();
  await disconnectEspn(user.id);

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  revalidatePath("/account");
}

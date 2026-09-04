"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";

import type { ManualFormState } from "@/components/leagues/manual-league-form";
import { createManualLeague } from "@/lib/leagues/manual";
import { planManualLeague } from "@/lib/leagues/manual-input";
import { startInitialSync } from "@/lib/sync/auto";
import { kickStage } from "@/lib/sync/pipeline";
import { createClient } from "@/lib/supabase/server";

/**
 * Opens a league nobody imported.
 *
 * The form is read by `planManualLeague`, which is pure and tested; everything
 * left here is the round trip. Written with the user's own client, so the RLS
 * policy on `leagues` is the authorization rather than a check we remembered.
 */
export async function createManualLeagueAction(
  _state: ManualFormState,
  formData: FormData,
): Promise<ManualFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=%2Fleagues%2Fnew");

  const planned = planManualLeague(Object.fromEntries(formData));
  if (!planned.ok) return { error: planned.error };

  let leagueId: string;
  try {
    ({ leagueId } = await createManualLeague(supabase, user.id, planned.plan));
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "Something went wrong.",
    };
  }

  // The board is marked dirty at birth, so the layout would start this on the
  // next page load anyway — but the roster picker searches Sleeper's master
  // list, and starting the pull now rather than one navigation later is the
  // difference between an empty picker and a working one.
  const pending = await startInitialSync(supabase, user.id, leagueId);
  if (pending) after(() => kickStage(pending.runId, pending.stageId));

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  redirect(`/leagues/${leagueId}/manage`);
}

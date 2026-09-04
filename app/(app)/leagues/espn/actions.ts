"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { EspnFormState } from "@/components/leagues/espn-league-form";
import { importEspnLeague } from "@/lib/leagues/espn";
import { planEspnConnect } from "@/lib/leagues/espn-input";
import { EspnAuthRequired } from "@/lib/sources/espn";
import { saveEspnCookies } from "@/lib/sources/espn-auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Connects an ESPN league.
 *
 * The form is read by `planEspnConnect`, which is pure and tested; what is
 * left here is the round trip. Written with the user's own client, so the RLS
 * policy on `leagues` is the authorization rather than a check we remembered.
 *
 * Cookies are saved before the league is read, on purpose: the read is the
 * thing that proves they work, and it cannot use them until they are stored.
 * A pair that turns out to be wrong is reported by the failed read and
 * replaced by the next attempt.
 */
export async function connectEspnLeagueAction(
  _state: EspnFormState,
  formData: FormData,
): Promise<EspnFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=%2Fleagues%2Fespn");

  const planned = planEspnConnect(Object.fromEntries(formData));
  if (!planned.ok) return { error: planned.error };

  let leagueId: string;
  try {
    if (planned.plan.cookies) {
      await saveEspnCookies(user.id, planned.plan.cookies);
    }

    ({ leagueId } = await importEspnLeague(supabase, user.id, planned.plan.ref));
  } catch (cause) {
    if (cause instanceof EspnAuthRequired) return { error: cause.message };
    return {
      error: cause instanceof Error ? cause.message : "Something went wrong.",
    };
  }

  revalidatePath("/leagues");
  revalidatePath("/dashboard");
  redirect(`/leagues/${leagueId}`);
}

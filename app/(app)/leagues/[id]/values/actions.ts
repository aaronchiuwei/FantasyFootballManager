"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { computeLeagueValues, type ValuationReport } from "@/lib/values/store";
import { YahooReauthRequired } from "@/lib/sources/yahoo-auth";
import { createClient } from "@/lib/supabase/server";

export type ValuationResult = { error?: string; report?: ValuationReport };

/**
 * Runs the §5 value engine over a league. Phase 4 folds this into sync stages
 * 3–5 and 8; for now it is its own button, the same way resolution is.
 */
export async function computeValuesAction(
  leagueId: string,
): Promise<ValuationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}/values`)}`);
  }

  try {
    const report = await computeLeagueValues(leagueId);
    revalidatePath(`/leagues/${leagueId}`);
    revalidatePath(`/leagues/${leagueId}/values`);
    return { report };
  } catch (cause) {
    if (cause instanceof YahooReauthRequired) {
      return { error: "Your Yahoo link expired. Reconnect Yahoo and try again." };
    }
    return {
      error: cause instanceof Error ? cause.message : "Something went wrong.",
    };
  }
}

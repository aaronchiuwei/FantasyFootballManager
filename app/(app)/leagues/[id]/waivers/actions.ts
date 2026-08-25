"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { saveWaiverLambda } from "@/lib/waivers/store";
import { createClient } from "@/lib/supabase/server";

/**
 * §7's λ, persisted — the fourth of §8's per-league tunables, and the only one
 * Phase 6 left at its default.
 *
 * The board itself re-ranks in the browser on every nudge, so this runs once,
 * on release, exactly like the trade knobs.
 */
export async function saveNeedWeightAction(
  leagueId: string,
  lambda: number,
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}/waivers`)}`);
  }

  try {
    await saveWaiverLambda(supabase, leagueId, lambda);
    revalidatePath(`/leagues/${leagueId}/waivers`);
    return {};
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "Something went wrong.",
    };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { clearManualWeek, saveManualSchedule } from "@/lib/matchups/manual";
import type { SchedulePair } from "@/lib/matchups/manual-input";
import { createClient } from "@/lib/supabase/server";

/**
 * The matchup screen's only writes, and they exist for one kind of league.
 *
 * Written like the manage screen's actions next door: the invariants live in
 * `lib/matchups/manual.ts`, and this file is the round trip and the sentence
 * the user reads when it fails.
 */

export type ScheduleResult = { error?: string };

async function requireUser(leagueId: string, week: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/leagues/${leagueId}/matchup?week=${week}`)}`,
    );
  }
  return supabase;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * The schedule is not priced off, so unlike the manage screen's writes this
 * revalidates the two screens that draw it and marks nothing for
 * recomputation. Values, needs and suggestions are claims about rosters; who
 * those rosters play is not an input to any of them.
 */
function refresh(leagueId: string) {
  revalidatePath(`/leagues/${leagueId}/matchup`);
  revalidatePath(`/leagues/${leagueId}`);
}

export async function saveScheduleAction(
  leagueId: string,
  week: number,
  pairs: SchedulePair[],
): Promise<ScheduleResult> {
  const supabase = await requireUser(leagueId, week);

  try {
    await saveManualSchedule(supabase, leagueId, week, pairs);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

export async function clearScheduleAction(
  leagueId: string,
  week: number,
): Promise<ScheduleResult> {
  const supabase = await requireUser(leagueId, week);

  try {
    await clearManualWeek(supabase, leagueId, week);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

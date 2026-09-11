"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { applyBestLineup, seatPlayer } from "@/lib/lineup/manual";
import { createClient } from "@/lib/supabase/server";

/**
 * The start/sit screen's writes, which exist for one kind of league.
 *
 * A lineup is a decision about a week, so both of these carry one — and it is
 * the week in the URL, which is the week the manager is looking at. Neither
 * takes the league's starting slots from the caller: they are the league's own
 * settings and the shape of every legal lineup in it, so both writers read
 * them from the row.
 */

export type LineupResult = { error?: string };

async function requireUser(leagueId: string, week: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/leagues/${leagueId}/lineup?week=${week}`)}`,
    );
  }
  return supabase;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * Revalidates the two weekly screens and nothing else. A lineup moves no value
 * and no needs vector — every other screen solves the best lineup for itself
 * and has never read a stored one — so there is nothing else to catch up.
 */
function refresh(leagueId: string) {
  revalidatePath(`/leagues/${leagueId}/lineup`);
  revalidatePath(`/leagues/${leagueId}/matchup`);
}

export async function autoFillLineupAction(
  leagueId: string,
  teamId: string,
  week: number,
): Promise<LineupResult> {
  const supabase = await requireUser(leagueId, week);

  try {
    await applyBestLineup(supabase, { leagueId, teamId, week });
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

export async function seatPlayerAction(
  leagueId: string,
  teamId: string,
  week: number,
  slot: string,
  incomingId: number | null,
  outgoingId: number | null,
): Promise<LineupResult> {
  const supabase = await requireUser(leagueId, week);

  try {
    await seatPlayer(supabase, {
      leagueId,
      teamId,
      week,
      slot,
      incomingId,
      outgoingId,
    });
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

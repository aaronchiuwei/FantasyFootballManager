"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { MoveItem } from "@/lib/transactions/moves";
import { deleteMove, recordMove } from "@/lib/transactions/store";

export type MoveResult = { error?: string };

/**
 * The move ledger's two writes.
 *
 * Recording is deliberately one action rather than one per kind. The store
 * derives what a move *is* from where the players go, so an "add" and a
 * "trade" reach this file as the same shape — which means the form can let
 * someone build a waiver claim and then attach a second team to it without
 * changing which action it submits to.
 */

async function requireUser(leagueId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}/moves`)}`);
  }
  return supabase;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/** Every screen that reads a roster is downstream of a move. */
function refresh(leagueId: string) {
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/moves`);
  revalidatePath(`/leagues/${leagueId}/manage`);
  revalidatePath(`/leagues/${leagueId}/values`);
  revalidatePath(`/leagues/${leagueId}/waivers`);
}

export async function recordMoveAction(
  leagueId: string,
  input: {
    items: MoveItem[];
    week: number | null;
    faabBid: number | null;
    note: string | null;
    occurredAt: string | null;
  },
): Promise<MoveResult> {
  const supabase = await requireUser(leagueId);

  try {
    await recordMove(supabase, leagueId, input);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

export async function deleteMoveAction(
  leagueId: string,
  transactionId: string,
): Promise<MoveResult> {
  const supabase = await requireUser(leagueId);

  try {
    await deleteMove(supabase, leagueId, transactionId);
  } catch (cause) {
    return { error: describe(cause) };
  }

  // Only the history changes: `deleteMove` leaves the rosters exactly as the
  // move left them, on purpose.
  revalidatePath(`/leagues/${leagueId}/moves`);
  return {};
}

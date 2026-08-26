"use server";

import { redirect } from "next/navigation";

import { buildPackagesFor, type BuiltPackages } from "@/lib/suggestions/store";
import { createClient } from "@/lib/supabase/server";

async function requireUser(leagueId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/leagues/${leagueId}/suggestions`)}`,
    );
  }

  return supabase;
}

function describe(cause: unknown) {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * §10, from the browser: "what would it take to get this player."
 *
 * A server action rather than a cached table, because the input is a player the
 * user named a moment ago — there is nothing about it to precompute, and the
 * search over one roster's subsets is small enough to run on the spot.
 *
 * The board is re-read here rather than trusted from the client, exactly as
 * `saveTradeAction` re-reads it: the browser sends two ids and the packages
 * that come back are the server's arithmetic over the server's values. The
 * user's RLS-bound client is what does the reading, so a league that is not
 * theirs simply has no rows.
 */
export async function buildPackagesAction(
  leagueId: string,
  input: { targetPlayerId: number; forTeamId: string },
): Promise<{ error?: string; result?: BuiltPackages }> {
  const supabase = await requireUser(leagueId);

  try {
    const result = await buildPackagesFor(supabase, leagueId, input);
    if (!result) {
      return {
        error:
          "That player is not on a roster in this league any more. Sync and try again.",
      };
    }

    return { result };
  } catch (cause) {
    return { error: describe(cause) };
  }
}

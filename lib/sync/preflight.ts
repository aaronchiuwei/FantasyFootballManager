import "server-only";

import { isManualLeague } from "@/lib/leagues/manual";
import { getYahooConnection } from "@/lib/sources/yahoo-auth";
import type { Db } from "@/lib/supabase/db";

/**
 * Whether a league can be synced at all, asked before any of it runs.
 *
 * Stages 6 and 7 are the only ones that need Yahoo, and they are the sixth and
 * seventh things a run does. Without this, a league whose link expired pulls
 * Sleeper's player master, ~24 FantasyCalc boards and two seasons of stat
 * lines — a minute or so of real work against three external APIs — and only
 * then discovers it cannot do the one thing the user pressed the button for.
 *
 * A manual league never asks Yahoo anything, so it always passes. That is the
 * point of checking the league rather than the account: having no Yahoo
 * connection is a completely normal state for someone who only keeps boards by
 * hand, and it must not stop them syncing.
 */

export type Preflight = { ok: true } | { ok: false; reason: string };

export const NEEDS_YAHOO_LINK =
  "This league is synced from Yahoo, and your Yahoo link is missing or expired. Reconnect Yahoo from the Leagues screen, then sync again.";

export async function preflightLeague(
  db: Db,
  userId: string,
  leagueId: string,
): Promise<Preflight> {
  const { data: league, error } = await db
    .from("leagues")
    .select("id, source")
    .eq("id", leagueId)
    .maybeSingle();

  if (error) return { ok: false, reason: `Could not read the league: ${error.message}` };
  if (!league) return { ok: false, reason: "That league does not exist." };
  if (isManualLeague(league.source)) return { ok: true };

  const connection = await getYahooConnection(userId);
  if (!connection.connected || connection.needsReauth) {
    return { ok: false, reason: NEEDS_YAHOO_LINK };
  }

  return { ok: true };
}

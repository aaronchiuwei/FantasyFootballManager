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

/**
 * The same question for a whole queue, asked once.
 *
 * `preflightLeague` would re-read the Yahoo token per league; a batch over
 * twelve boards would ask twelve times for an answer that cannot change
 * between them. The connection is read once and the leagues are sorted against
 * it, so "sync every board" can quietly leave out the ones that would only
 * fail and say how many it left.
 */
export async function preflightQueue(
  db: Db,
  userId: string,
  leagueIds: string[],
): Promise<{ syncable: string[]; blocked: string[] }> {
  if (leagueIds.length === 0) return { syncable: [], blocked: [] };

  const { data } = await db
    .from("leagues")
    .select("id, source")
    .in("id", leagueIds);

  const sourceById = new Map(
    (data ?? []).map((league) => [league.id, league.source]),
  );

  const needsYahoo = leagueIds.some(
    (id) => !isManualLeague(sourceById.get(id)),
  );
  const yahooUsable = needsYahoo
    ? await getYahooConnection(userId).then(
        (link) => link.connected && !link.needsReauth,
      )
    : false;

  const syncable: string[] = [];
  const blocked: string[] = [];

  // The caller's order is preserved: the queue is ordered newest season first
  // so an interrupted batch has already done the boards most likely to be
  // looked at today, and filtering must not disturb that.
  for (const id of leagueIds) {
    const manual = isManualLeague(sourceById.get(id));
    if (manual || yahooUsable) syncable.push(id);
    else blocked.push(id);
  }

  return { syncable, blocked };
}

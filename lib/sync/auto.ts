import "server-only";

import { isManualLeague } from "@/lib/leagues/manual";
import type { Db } from "@/lib/supabase/db";

import type { StageId } from "./plan";
import { createRun } from "./run";

/**
 * Keeping a hand-kept league current without asking anyone to press anything.
 *
 * A manual league has no sync button, and that is a deliberate choice with a
 * consequence: something else has to notice that the board is out of date.
 * There is no Yahoo to poll and no schedule that would know — what makes a
 * manual league stale is the user editing it, which is an event this app is
 * already in the middle of when it happens.
 *
 * So `last_synced_at` is used as a dirty mark rather than a timestamp anyone
 * reads. Every write to a manual league clears it; a successful run sets it.
 * A null therefore means "there are edits nothing has been recomputed for",
 * which is exactly the question this needs to answer, and it needs no column
 * of its own and no clock comparison that could disagree with itself.
 */

/**
 * Whether a roster changed after the last run began.
 *
 * The null mark alone would miss an edit made *while* a run was in flight:
 * that run stamps the league on the way out, and the edit it never read would
 * be recorded as priced. `rosters.updated_at` against the run's start time is
 * the second opinion, and it is the case that actually happens — someone adds
 * a player, the page navigates, and a run kicked off by the previous edit is
 * still going.
 *
 * A removal leaves no row to carry a timestamp, so it is covered by the mark
 * rather than by this, and a removal during a run is the one edit that can
 * still wait for the next one to flush it.
 */
async function rostersMovedSince(
  db: Db,
  league: { id: string; last_synced_at: string | null },
): Promise<boolean> {
  if (league.last_synced_at === null) return true;

  const { data: teams } = await db
    .from("teams")
    .select("id")
    .eq("league_id", league.id);

  const teamIds = (teams ?? []).map((team) => team.id);
  if (teamIds.length === 0) return false;

  const { data } = await db
    .from("rosters")
    .select("updated_at")
    .in("team_id", teamIds)
    .gt("updated_at", league.last_synced_at)
    .limit(1);

  return (data ?? []).length > 0;
}

/** Clears the mark. Called by every write that changes what a league is. */
export async function markLeagueDirty(db: Db, leagueId: string): Promise<void> {
  // Best effort on purpose. Failing to clear the mark costs a recomputation
  // that the next edit will trigger anyway; failing the user's edit because
  // the bookkeeping did not land would be much worse.
  await db.from("leagues").update({ last_synced_at: null }).eq("id", leagueId);
}

/**
 * Starts a sync for a manual league whose edits have not been priced yet.
 *
 * Called from page loads, so it has to be cheap when there is nothing to do —
 * one indexed read in the common case — and it must never start a second run
 * for a league that already has one, which `createRun` guarantees through the
 * one-active-run index.
 *
 * It deliberately does *not* retry a failed run. A league whose sync fails on
 * every attempt would otherwise start one on every page view, and the failure
 * is shown on the league page with a control to try again — the one place a
 * manual league still offers that, because a broken thing needs a way to be
 * unbroken.
 */
export async function ensureManualLeagueSynced(
  db: Db,
  userId: string,
  league: { id: string; source: string; last_synced_at: string | null },
): Promise<{ runId: string; stageId: StageId } | null> {
  if (!isManualLeague(league.source)) return null;
  if (league.last_synced_at !== null && !(await rostersMovedSince(db, league)))
    return null;

  const { data: latest } = await db
    .from("sync_runs")
    .select("status")
    .eq("league_id", league.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.status === "running" || latest?.status === "failed") return null;

  try {
    const started = await createRun(db, userId, league.id);
    // The run row is written here, where the caller's session is still live.
    // Only the kick is handed back, because it is a fetch and the caller wants
    // it after its response rather than inside it.
    return started.alreadyRunning
      ? null
      : { runId: started.runId, stageId: started.stageId };
  } catch {
    // A league that could not be queued stays marked dirty, and the next page
    // load tries again. Nothing here is worth failing a render over.
    return null;
  }
}

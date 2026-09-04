import "server-only";

import type { Db } from "@/lib/supabase/db";

import { kickStage } from "./pipeline";
import { afterLeague, nextInQueue, type SyncBatch, type StageId } from "./plan";
import { createRun } from "./run";

/**
 * Syncing every board, one after another.
 *
 * The pipeline already knows how to hand one stage to the next; this is the
 * same trick one level up. A batch is not an orchestrator holding five runs
 * open — nothing here waits for anything. The queue rides in the first run's
 * context, and when that run ends it starts the next league and passes the
 * remainder along, exactly the way `kickStage` passes a run along.
 *
 * That shape is what makes it survive a serverless environment: there is never
 * a process whose job is to remember the batch. The record of it is a row.
 */

export type BatchStart = {
  runId: string;
  /** The stage the caller has to kick to set the run going. */
  stageId: StageId;
  /** The league whose run was opened. */
  leagueId: string;
};

/**
 * Starts the first league in `queue` that can be started, and hands the rest
 * to it.
 *
 * A league already mid-sync is skipped rather than joined. Joining would mean
 * attaching this queue to a run that is already past the stage that would have
 * carried it, so the batch would end when that run did — quietly, several
 * leagues early. Skipping costs one league its refresh and keeps the chain
 * honest, and the league it skipped is the one already being refreshed.
 *
 * It opens the run but does not kick it, because the two callers want that at
 * different moments: a request handler defers the kick past its response, and
 * the pipeline — already inside a background invocation — wants it now.
 */
export async function startBatch(
  db: Db,
  userId: string,
  queue: string[],
  progress: { done: number; total: number },
): Promise<BatchStart | null> {
  let batch: SyncBatch = { queue, done: progress.done, total: progress.total };

  for (let step = nextInQueue(batch); step !== null; step = nextInQueue(batch)) {
    const started = await createRun(db, userId, step.leagueId, {
      batch: step.carry,
    });

    if (!started.alreadyRunning) {
      return {
        runId: started.runId,
        stageId: started.stageId,
        leagueId: step.leagueId,
      };
    }

    batch = afterLeague(step.carry);
  }

  return null;
}

/**
 * Called when a run ends — passed or failed — to start the next league.
 *
 * A failed league does not stop the batch. "Sync every board" is a request
 * about all of them, and one league whose Yahoo link expired is not a reason
 * to leave the other four stale; the failure is recorded on its own run, where
 * that league's own screen will show it.
 */
export async function advanceBatch(
  admin: Db,
  userId: string,
  batch: SyncBatch | undefined,
): Promise<void> {
  if (!batch || batch.queue.length === 0) return;

  const next = afterLeague(batch);
  const started = await startBatch(admin, userId, next.queue, {
    done: next.done,
    total: next.total,
  });

  if (started) await kickStage(started.runId, started.stageId);
}

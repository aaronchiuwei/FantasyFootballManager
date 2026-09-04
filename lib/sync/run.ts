import "server-only";

import type { Db } from "@/lib/supabase/db";
import type { Database, Json } from "@/lib/supabase/database.types";

import {
  contextOf as contextOfRecord,
  initialStages,
  patchStage,
  reopenFrom,
  resumeFrom,
  STAGE_IDS,
  toSyncRun as toSyncRunRecord,
  type StageId,
  type StageState,
  type SyncContext,
  type SyncRun,
} from "./plan";

type RunRow = Database["public"]["Tables"]["sync_runs"]["Row"];

/**
 * A run that has not touched its row in this long is not slow, it is dead —
 * the invocation was killed before it could record a failure. The next sync
 * closes it out rather than being blocked forever by the one-active-run index.
 */
export const STALE_RUN_MS = 5 * 60 * 1000;

export function toSyncRun(row: RunRow): SyncRun {
  return toSyncRunRecord(row);
}

export function contextOf(row: RunRow): SyncContext {
  return contextOfRecord(row);
}

async function readRow(db: Db, runId: string): Promise<RunRow> {
  const { data, error } = await db
    .from("sync_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (error || !data) {
    throw new Error(`Sync run not found: ${error?.message ?? runId}`);
  }
  return data;
}

/** The league's most recent run, for the page's initial render. */
export async function latestRun(
  db: Db,
  leagueId: string,
): Promise<SyncRun | null> {
  const { data, error } = await db
    .from("sync_runs")
    .select("*")
    .eq("league_id", leagueId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to read sync runs: ${error.message}`);
  return data ? toSyncRun(data) : null;
}

/** Closes out a run whose invocation died without recording anything. */
async function reapStale(db: Db, leagueId: string): Promise<void> {
  const { data } = await db
    .from("sync_runs")
    .select("*")
    .eq("league_id", leagueId)
    .eq("status", "running")
    .maybeSingle();

  if (!data) return;
  if (Date.now() - Date.parse(data.updated_at) < STALE_RUN_MS) return;

  const stages = (data.stages as unknown as StageState[]).map((stage) =>
    stage.status === "running"
      ? { ...stage, status: "failed" as const, error: "Stage stopped responding" }
      : stage,
  );

  await db
    .from("sync_runs")
    .update({
      status: "failed",
      stages: stages as unknown as Json,
      error: "The sync stopped responding and was closed out.",
      finished_at: new Date().toISOString(),
    })
    .eq("id", data.id);
}

export type StartedRun = {
  runId: string;
  stageId: StageId;
  /** True when an in-flight run was returned instead of a new one. */
  alreadyRunning: boolean;
};

/**
 * Opens a run for a league, or hands back the one already in flight.
 *
 * Written with the caller's own RLS-bound client so ownership is enforced by
 * the policy rather than by a check we remembered to write — from here on the
 * pipeline runs under the service role, and this row is the record of who
 * authorized it.
 */
export async function createRun(
  db: Db,
  userId: string,
  leagueId: string,
  /**
   * Context to seed the row with. Only "sync every board" uses it, to put the
   * rest of the queue somewhere that survives to the end of the run — stage 1
   * writes the season clock *over* this, and `markStageSettled` merges rather
   * than replaces, so a seeded key is still there when the run finishes.
   */
  seed: Partial<SyncContext> = {},
): Promise<StartedRun> {
  await reapStale(db, leagueId);

  const { data, error } = await db
    .from("sync_runs")
    .insert({
      user_id: userId,
      league_id: leagueId,
      status: "running",
      stages: initialStages() as unknown as Json,
      context: seed as unknown as Json,
    })
    .select("id")
    .single();

  if (data) return { runId: data.id, stageId: STAGE_IDS[0], alreadyRunning: false };

  // 23505: the one-active-run index. Someone double-clicked, or a second tab
  // is already watching a live run — either way, join it rather than fight it.
  if (error?.code === "23505") {
    const { data: active } = await db
      .from("sync_runs")
      .select("*")
      .eq("league_id", leagueId)
      .eq("status", "running")
      .maybeSingle();

    if (active) {
      const stages = active.stages as unknown as StageState[];
      return {
        runId: active.id,
        stageId: resumeFrom(stages) ?? STAGE_IDS[0],
        alreadyRunning: true,
      };
    }
  }

  throw new Error(`Failed to start sync: ${error?.message ?? "unknown error"}`);
}

/**
 * Reopens a finished-but-failed run at its first unfinished stage. §9's
 * "retry from failed stage": stages 1–5 stay committed, and only the work that
 * actually broke is paid for again.
 */
export async function retryRun(db: Db, runId: string): Promise<StartedRun> {
  const row = await readRow(db, runId);
  const stages = row.stages as unknown as StageState[];
  const from = resumeFrom(stages) ?? STAGE_IDS[0];

  // A retry is a single-league sync, never a link in a batch — so the queue is
  // dropped rather than carried. It has already been handed on: whichever way
  // this run first ended, the league after it was started then. Leaving the
  // queue here would start that league a second time when the retry lands, and
  // every league behind it again after that.
  const { batch: _batch, ...context } = contextOf(row);
  void _batch;

  const { error } = await db
    .from("sync_runs")
    .update({
      status: "running",
      stages: reopenFrom(stages, from) as unknown as Json,
      context: context as unknown as Json,
      error: null,
      finished_at: null,
    })
    .eq("id", runId);

  if (error) throw new Error(`Failed to retry sync: ${error.message}`);
  return { runId, stageId: from, alreadyRunning: false };
}

// ---------------------------------------------------------------------------
// stage transitions — service role, driven by the pipeline
// ---------------------------------------------------------------------------

export async function markStageRunning(
  admin: Db,
  runId: string,
  stageId: StageId,
): Promise<RunRow> {
  const row = await readRow(admin, runId);
  const stages = patchStage(row.stages as unknown as StageState[], stageId, {
    status: "running",
    startedAt: new Date().toISOString(),
    error: null,
  });

  const { error } = await admin
    .from("sync_runs")
    .update({ stages: stages as unknown as Json })
    .eq("id", runId);

  if (error) throw new Error(`Failed to record stage start: ${error.message}`);
  return { ...row, stages: stages as unknown as Json };
}

export type StageOutcome = {
  detail: string;
  skipped?: boolean;
  warnings?: string[];
  context?: Partial<SyncContext>;
};

export async function markStageSettled(
  admin: Db,
  runId: string,
  stageId: StageId,
  outcome: StageOutcome,
): Promise<void> {
  const row = await readRow(admin, runId);
  const stages = patchStage(row.stages as unknown as StageState[], stageId, {
    status: outcome.skipped ? "skipped" : "done",
    detail: outcome.detail,
    warnings: outcome.warnings ?? [],
    finishedAt: new Date().toISOString(),
  });

  const context = { ...contextOf(row), ...outcome.context };

  const { error } = await admin
    .from("sync_runs")
    .update({
      stages: stages as unknown as Json,
      context: context as unknown as Json,
    })
    .eq("id", runId);

  if (error) throw new Error(`Failed to record stage result: ${error.message}`);
}

export async function markRunFailed(
  admin: Db,
  runId: string,
  stageId: StageId,
  message: string,
  context?: Partial<SyncContext>,
): Promise<void> {
  const row = await readRow(admin, runId);
  const stages = patchStage(row.stages as unknown as StageState[], stageId, {
    status: "failed",
    finishedAt: new Date().toISOString(),
    error: message,
  });

  await admin
    .from("sync_runs")
    .update({
      status: "failed",
      stages: stages as unknown as Json,
      context: { ...contextOf(row), ...context } as unknown as Json,
      error: message,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

export async function markRunSucceeded(
  admin: Db,
  runId: string,
): Promise<void> {
  await admin
    .from("sync_runs")
    .update({
      status: "succeeded",
      error: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}


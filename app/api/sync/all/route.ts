import { after, NextResponse } from "next/server";

import { startBatch } from "@/lib/sync/batch";
import { kickStage } from "@/lib/sync/pipeline";
import { preflightQueue } from "@/lib/sync/preflight";
import {
  STAGE_LABELS,
  STALL_AFTER_MS,
  type StageId,
  type StageState,
} from "@/lib/sync/plan";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Sync every board this user owns, one after another.
 *
 * The queue is built from an RLS-scoped read, so it can only ever contain
 * leagues this user owns — the list is the authorization, and the run row the
 * first league gets is the record of who asked for it (§9). From there the
 * chain runs under the service role like any other stage handoff.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: leagues, error } = await supabase
    .from("leagues")
    .select("id")
    // Newest season first: if a batch is going to be interrupted, the league
    // most likely to be looked at today should already be done.
    .order("season", { ascending: false })
    .order("name");

  if (error) {
    return NextResponse.json(
      { error: `Could not read your leagues: ${error.message}` },
      { status: 500 },
    );
  }

  const all = (leagues ?? []).map((league) => league.id);
  if (all.length === 0) {
    return NextResponse.json({ error: "You have no leagues yet." }, { status: 400 });
  }

  // A Yahoo league with no usable link is left out rather than queued to fail.
  // Queuing it would spend the full pipeline on each one before dying at stage
  // 6, serially, which is the slowest possible way to deliver bad news.
  const { syncable: queue, blocked } = await preflightQueue(supabase, user.id, all);

  if (queue.length === 0) {
    return NextResponse.json(
      {
        error:
          "Every league here is synced from Yahoo, and your Yahoo link is missing or expired. Reconnect Yahoo and try again.",
      },
      { status: 409 },
    );
  }

  try {
    const started = await startBatch(supabase, user.id, queue, {
      done: 0,
      total: queue.length,
    });

    if (!started) {
      return NextResponse.json({
        total: queue.length,
        started: 0,
        blocked: blocked.length,
        note: "Every league already has a sync in flight.",
      });
    }

    // The run rows are written before the response; only the kick is deferred,
    // because it is a fetch whose answer this response has no use for — the
    // same reason `/api/sync` defers its own.
    after(() => kickStage(started.runId, started.stageId));

    return NextResponse.json({
      total: queue.length,
      started: 1,
      blocked: blocked.length,
    });
  } catch (cause) {
    return NextResponse.json(
      {
        error: cause instanceof Error ? cause.message : "Failed to start the sync.",
      },
      { status: 500 },
    );
  }
}

export type BatchStatus = {
  /** The league being synced right now, if any. */
  running: {
    leagueId: string;
    leagueName: string;
    stage: StageId | null;
    stageLabel: string | null;
    /**
     * True once the run has gone quiet for longer than a stage should take.
     *
     * A killed invocation leaves a row saying `running` that nothing will ever
     * finish, and a button that waits on it waits forever. Reported so the
     * control can offer to start again — which reaps the dead run on its way
     * past, because `createRun` already closes out a stale one.
     */
    stalled: boolean;
  } | null;
  /**
   * Position in a "sync every board" queue — present only when the live run
   * actually belongs to one. A single-league sync started from that league's
   * own page is still reported as `running`, but it is not a batch and must
   * not be counted as "1 of 5".
   */
  batch: { done: number; total: number } | null;
};

/**
 * Where the batch has got to.
 *
 * One row, not a report over every league: the button only needs to say which
 * board is being worked on and how far through the queue that is. Per-league
 * outcomes are already on each league's own page, which is where someone
 * looking for them will go.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data } = await supabase
    .from("sync_runs")
    .select("league_id, stages, context, updated_at, leagues (name)")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ running: null, batch: null } satisfies BatchStatus);
  }

  const stages = data.stages as unknown as StageState[];
  const active = stages.find((stage) => stage.status === "running") ?? null;
  const context = (data.context ?? {}) as { batch?: { done: number; total: number } };
  const league = data.leagues as unknown as { name: string } | null;

  return NextResponse.json({
    running: {
      leagueId: data.league_id,
      leagueName: league?.name ?? "a league",
      stage: active?.id ?? null,
      stageLabel: active ? STAGE_LABELS[active.id] : null,
      stalled: Date.now() - Date.parse(data.updated_at) > STALL_AFTER_MS,
    },
    batch: context.batch
      ? { done: context.batch.done, total: context.batch.total }
      : null,
  } satisfies BatchStatus);
}

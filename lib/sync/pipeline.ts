import "server-only";

import { signPayload, verifySignature } from "@/lib/crypto";
import { getSiteUrl } from "@/lib/site-url";
import { YahooReauthRequired } from "@/lib/sources/yahoo-auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { nextStage, type StageId, type SyncContext } from "./plan";
import {
  contextOf,
  markRunFailed,
  markRunSucceeded,
  markStageRunning,
  markStageSettled,
} from "./run";
import { STAGE_RUNNERS } from "./stages";

/**
 * Proof that a stage request came from us.
 *
 * The pipeline chains itself over HTTP because each stage needs its own
 * serverless invocation and its own timeout budget (§9). Those hops carry no
 * cookie session, so they are authorized by an HMAC over the run id — scoped
 * to one run, and derived from a secret the app already has.
 */
export function runToken(runId: string): string {
  return signPayload(`sync:${runId}`);
}

export function verifyRunToken(runId: string, token: string | null): boolean {
  return token !== null && verifySignature(`sync:${runId}`, token);
}

/**
 * Long enough to be sure the next stage's request was delivered, short enough
 * not to hold this invocation open for the work it triggered. The receiving
 * function runs to completion regardless of whether we wait for its response.
 */
const KICK_TIMEOUT_MS = 2_000;

/** Hands the next stage to a fresh invocation and stops caring what it says. */
export async function kickStage(runId: string, stageId: StageId): Promise<void> {
  try {
    await fetch(`${getSiteUrl()}/api/sync/${stageId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${runToken(runId)}`,
      },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // An abort means the request was sent and the stage is running; a genuine
    // network failure leaves the run visibly stuck, which the UI reports as a
    // stall and offers to retry. Either way there is nothing useful to do here.
  }
}

function describe(cause: unknown): string {
  if (cause instanceof YahooReauthRequired) {
    return "Your Yahoo link expired. Reconnect Yahoo and run the sync again.";
  }
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * Runs one stage to completion, records the outcome, and hands off.
 *
 * Never throws: a stage that fails is recorded as failed on the run so the UI
 * can offer "retry from here", and the chain simply stops. §9's guarantee is
 * that the stages before it stay committed.
 */
export async function executeStage(
  runId: string,
  stageId: StageId,
): Promise<void> {
  const admin = createAdminClient();
  const row = await markStageRunning(admin, runId, stageId);
  const context = contextOf(row);

  // Every stage after the first reads the season clock stage 1 wrote. An empty
  // context means the run was resumed from the middle of a row that never had
  // one, which is a retry-from-the-top, not a stage failure to puzzle over.
  if (stageId !== "state" && !context.leagueKey) {
    await markRunFailed(
      admin,
      runId,
      stageId,
      "The sync lost its season context. Start a fresh sync.",
    );
    return;
  }

  try {
    const outcome = await STAGE_RUNNERS[stageId]({
      db: admin,
      userId: row.user_id,
      leagueId: row.league_id,
      context,
    });

    await markStageSettled(admin, runId, stageId, outcome);

    const next = nextStage(stageId);
    if (next) {
      await kickStage(runId, next);
    } else {
      await markRunSucceeded(admin, runId);
    }
  } catch (cause) {
    const patch: Partial<SyncContext> =
      cause instanceof YahooReauthRequired ? { needsReauth: true } : {};

    await markRunFailed(admin, runId, stageId, describe(cause), patch);
  }
}

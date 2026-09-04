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
/**
 * Records a handoff that never landed, on the run it was meant to advance.
 *
 * This used to be swallowed. The reasoning was that a dead kick leaves the run
 * visibly stuck and the UI calls it a stall, so there was nothing useful to
 * say — but "stopped responding" ninety seconds later is the *symptom*, and it
 * points at the stage rather than at the hop that failed to reach it. The
 * common cause is mundane and completely invisible from that message: the app
 * chains stages over HTTP to its own origin, so a `NEXT_PUBLIC_SITE_URL`
 * pointing somewhere other than the server actually running means every stage
 * after the first is handed to a different deployment, or to nothing at all.
 */
async function recordDeadKick(
  runId: string,
  stageId: StageId,
  detail: string,
  protectedDeployment = false,
): Promise<void> {
  const remedy = protectedDeployment
    ? `Point NEXT_PUBLIC_SITE_URL at the production domain, which is not protected, or set VERCEL_AUTOMATION_BYPASS_SECRET so the app can call itself.`
    : `If ${getSiteUrl()} is not the server you are running, set NEXT_PUBLIC_SITE_URL to the origin that is.`;

  try {
    await markRunFailed(
      createAdminClient(),
      runId,
      stageId,
      `${detail} Stages are chained over HTTP to ${getSiteUrl()}. ${remedy}`,
    );
  } catch {
    // Reporting the failure failed. The run still stalls and the UI still
    // offers a retry, which is where this came in.
  }
}

/**
 * Vercel's own way past Deployment Protection.
 *
 * Preview deployments are protected by default, and the protection sits in
 * front of the function rather than inside it — so an app that chains its own
 * stages over HTTP cannot reach itself, and the 401 it gets back is Vercel's,
 * not this app's. Setting the project's automation bypass secret makes the
 * self-call work without turning protection off for everyone else.
 *
 * Absent everywhere else, where it costs nothing to send nothing.
 */
function bypassHeaders(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

/** Vercel's protection payload, as distinct from a 401 this app produced. */
async function isDeploymentProtection(response: Response): Promise<boolean> {
  try {
    const body = await response.text();
    return body.includes('"protection"') || body.includes("Protected deployment");
  } catch {
    return false;
  }
}

export async function kickStage(runId: string, stageId: StageId): Promise<void> {
  try {
    const response = await fetch(`${getSiteUrl()}/api/sync/${stageId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${runToken(runId)}`,
        ...bypassHeaders(),
      },
      body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
      cache: "no-store",
    });

    // A 2xx means the stage is running and will report on itself. Anything
    // else is an answer from something that is not going to run it: a stale
    // deployment with no such route, or one whose signing secret differs.
    if (!response.ok) {
      // A 401 has two very different causes and only one of them is ours, so
      // the message says which. Vercel's protection answers before the route
      // is ever reached, and telling someone to check a signing secret when
      // the request never arrived sends them a long way in the wrong
      // direction.
      const protectedDeployment =
        response.status === 401 && (await isDeploymentProtection(response));

      await recordDeadKick(
        runId,
        stageId,
        protectedDeployment
          ? `Vercel Deployment Protection refused the ${stageId} stage: the app cannot call itself at a protected deployment URL.`
          : `The sync pipeline answered ${response.status} instead of starting the ${stageId} stage.`,
        protectedDeployment,
      );
    }
  } catch (cause) {
    // The timeout is the *expected* path, not a failure: the request was
    // delivered and the receiving function runs to completion whether or not
    // anyone waits for its response. Only a genuine transport failure —
    // refused connection, unresolvable host — means nobody got it.
    if (cause instanceof Error && cause.name === "TimeoutError") return;

    await recordDeadKick(
      runId,
      stageId,
      "The sync pipeline could not be reached to start the next stage.",
    );
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
      return;
    }

    await markRunSucceeded(admin, runId);
  } catch (cause) {
    const patch: Partial<SyncContext> =
      cause instanceof YahooReauthRequired ? { needsReauth: true } : {};

    await markRunFailed(admin, runId, stageId, describe(cause), patch);
  }
}

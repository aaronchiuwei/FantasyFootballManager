import { after, NextResponse } from "next/server";
import { z } from "zod";

import { kickStage } from "@/lib/sync/pipeline";
import { createRun, latestRun, retryRun } from "@/lib/sync/run";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BodySchema = z.union([
  z.object({ leagueId: z.uuid() }),
  z.object({ runId: z.uuid() }),
]);

/**
 * Starts a sync, or resumes a failed one.
 *
 * This is the only entry point a browser touches, and the only one that runs
 * as the signed-in user. Ownership is enforced by RLS on the insert; from here
 * the pipeline runs under the service role, and the row this creates is the
 * record of who authorized it (§9).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const started =
      "runId" in parsed.data
        ? await retryRun(supabase, parsed.data.runId)
        : await createRun(supabase, user.id, parsed.data.leagueId);

    // Joining a run that is already in flight must not kick it a second time —
    // two invocations of one stage would race each other over the same rows.
    if (!started.alreadyRunning) {
      after(() => kickStage(started.runId, started.stageId));
    }

    return NextResponse.json({
      runId: started.runId,
      stage: started.stageId,
      alreadyRunning: started.alreadyRunning,
    });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "Failed to start sync." },
      { status: 500 },
    );
  }
}

/** The league's most recent run, for a client that reconnects mid-sync. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const leagueId = new URL(request.url).searchParams.get("leagueId");
  if (!leagueId) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  return NextResponse.json({ run: await latestRun(supabase, leagueId) });
}

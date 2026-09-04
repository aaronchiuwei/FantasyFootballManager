import { after, NextResponse } from "next/server";

import { isStageId } from "@/lib/sync/plan";
import { runPipeline, verifyRunToken } from "@/lib/sync/pipeline";

export const runtime = "nodejs";

/**
 * The whole run happens here now, not one stage of it.
 *
 * §9 gave each stage its own invocation and its own ~60s; Vercel's loop
 * detection made that impossible (see `runPipeline`), so the eight stages
 * share one ceiling instead. 300s is the Node maximum on Vercel Pro; on a plan
 * capped lower this is clamped, and a run that overruns is reaped as stalled
 * and resumes from its first unfinished stage rather than starting over.
 */
export const maxDuration = 300;

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Runs a sync from `stage` to the end.
 *
 * Machine-to-machine: whatever started the run calls this once, authenticated
 * by an HMAC over the run id rather than by a session. The path still names a
 * stage because that is what makes "retry from here" a plain request for the
 * stage that failed.
 *
 * The work happens in `after()` so the caller's request completes immediately
 * instead of being held open for the length of the run it just triggered.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ stage: string }> },
) {
  const { stage } = await params;
  if (!isStageId(stage)) {
    return NextResponse.json({ error: "Unknown stage." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const runId =
    body && typeof body === "object" && typeof (body as { runId?: unknown }).runId === "string"
      ? (body as { runId: string }).runId
      : null;

  if (!runId || !verifyRunToken(runId, bearer(request))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  after(() => runPipeline(runId, stage));
  return NextResponse.json({ accepted: true, stage });
}

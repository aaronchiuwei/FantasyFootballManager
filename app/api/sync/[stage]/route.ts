import { after, NextResponse } from "next/server";

import { isStageId } from "@/lib/sync/plan";
import { executeStage, verifyRunToken } from "@/lib/sync/pipeline";

export const runtime = "nodejs";

/** §9: keep any single stage under ~60s, which is also Vercel's Node ceiling. */
export const maxDuration = 60;

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Runs one stage of a sync.
 *
 * Machine-to-machine: the previous stage calls this, authenticated by an HMAC
 * over the run id rather than by a session. The work happens in `after()` so
 * the caller's request completes immediately instead of being held open for
 * the length of the stage it just triggered.
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

  after(() => executeStage(runId, stage));
  return NextResponse.json({ accepted: true, stage });
}

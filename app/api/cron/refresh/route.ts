import { NextResponse } from "next/server";

import { refreshGlobalData } from "@/lib/sync/global-refresh";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Sleeper player master + ~24 FantasyCalc boards + weekly stats can exceed 60s. */
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function runRefresh(request: Request) {
  const db = createAdminClient();
  // `?force=1` re-pulls the player master even inside its 24h TTL. The
  // schedule never passes it; a human does, after a change to what the parser
  // accepts, when waiting up to a day for the cache to lapse is the only thing
  // standing between a real player and the board.
  const force = new URL(request.url).searchParams.get("force") === "1";
  return refreshGlobalData(db, { force });
}

/**
 * Scheduled global refresh — no Yahoo required.
 *
 * Vercel Cron invokes this with `Authorization: Bearer $CRON_SECRET`. The same
 * header works for manual triggers during development.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const report = await runRefresh(request);
    return NextResponse.json({ ok: true, ...report });
  } catch (cause) {
    console.error("Global refresh failed:", cause);
    return NextResponse.json(
      {
        ok: false,
        error: cause instanceof Error ? cause.message : "Refresh failed.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}

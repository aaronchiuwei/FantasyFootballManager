import { NextResponse } from "next/server";

import { refreshLiveWeek } from "@/lib/matchups/live-refresh";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * One league's live week, re-pulled.
 *
 * POST because it writes, and behind the user's own session rather than the
 * HMAC chain `/api/sync` uses: this is not a stage handing work to another
 * stage, it is a page asking for its own numbers. RLS does the rest — the
 * caller's client can only read and write a league they own, so the id in the
 * path is checked by the database rather than by a branch here.
 *
 * Errors come back as 200 with a reason on the body rather than as a status
 * the browser logs. A poller that prints a red line in the console every
 * forty-five seconds because somebody's Yahoo token lapsed is a poller that
 * makes a working app look broken; the component upstairs decides what to say
 * and when to give up.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in." });
  }

  const body = await request.json().catch(() => null);
  const week = Number((body as { week?: unknown } | null)?.week);

  if (!Number.isInteger(week)) {
    return NextResponse.json({ ok: false, error: "No week given." });
  }

  try {
    // The caller's client authorizes and writes what they own; the service
    // role writes the two global stat tables nobody owns. See the module.
    const report = await refreshLiveWeek(supabase, createAdminClient(), user.id, {
      leagueId: id,
      week,
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (cause) {
    return NextResponse.json({
      ok: false,
      error: cause instanceof Error ? cause.message : "Refresh failed.",
    });
  }
}

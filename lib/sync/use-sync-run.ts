"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  isStalled,
  toSyncRun,
  type SyncRun,
  type SyncRunRecord,
} from "./plan";

async function post(body: Record<string, string>): Promise<void> {
  const response = await fetch("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "The sync would not start.");
  }
}

/** Backstop poll, only while a run is live. Realtime is the fast path. */
const POLL_MS = 4_000;

export type SyncRunState = {
  run: SyncRun | null;
  starting: boolean;
  stalled: boolean;
  start: () => Promise<void>;
  retry: () => Promise<void>;
};

/**
 * Live progress for a league's sync.
 *
 * The subscription is on the league rather than on one run id, so a retry —
 * which reopens the same row — and a sync started in another tab both land
 * here without re-subscribing. Realtime applies the `sync_runs` owner policy
 * to the socket's own JWT, so this streams only the user's own runs.
 *
 * A slow poll runs alongside it while a sync is in flight. Realtime is the
 * thing that makes the checklist feel live, but a progress UI that shows
 * nothing at all when a publication was not applied is a worse failure than a
 * few extra requests.
 */
export function useSyncRun(
  leagueId: string,
  initialRun: SyncRun | null,
  { onSettled }: { onSettled?: (run: SyncRun) => void } = {},
): SyncRunState {
  const [run, setRun] = useState<SyncRun | null>(initialRun);
  const [starting, setStarting] = useState(false);
  const [stalled, setStalled] = useState(false);

  // Kept in refs so the callback and the settle bookkeeping are not
  // dependencies of the subscription, which would tear it down on every render.
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const lastSettled = useRef<string | null>(
    initialRun && initialRun.status !== "running" ? initialRun.id : null,
  );

  const accept = useCallback((next: SyncRun) => {
    setRun((current) =>
      // A late update about an older run must not overwrite a newer one.
      current && Date.parse(current.startedAt) > Date.parse(next.startedAt)
        ? current
        : next,
    );

    if (next.status === "running") {
      lastSettled.current = null;
    } else if (lastSettled.current !== next.id) {
      lastSettled.current = next.id;
      settled.current?.(next);
    }
  }, []);

  /**
   * §10's performance guardrail — "dynamic-import [the heavy things]" — applied
   * to the heaviest thing this app actually ships to the browser.
   *
   * The Supabase browser client drags `realtime-js` and its WebSocket stack in
   * behind it, and a `SyncButton` sits on every league screen, so a static
   * import put that on the critical path of the values board, the waiver wire
   * and the analyzer alike — pages whose entire argument is that they run their
   * own arithmetic locally and fast. It is imported here, inside the effect,
   * so it loads after the page is interactive and in parallel with nothing the
   * user is waiting on.
   *
   * Nothing about the behaviour changes: the subscription is opened on mount as
   * before, and the poll in the next effect is the fallback it always was — so
   * a run that settles before the chunk arrives is still picked up.
   */
  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | null = null;

    void (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      // Unmounted while the chunk was in flight: opening a socket now would
      // leak one nothing is left to close.
      if (cancelled) return;

      const supabase = createClient();
      const channel = supabase
        .channel(`sync_runs:${leagueId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "sync_runs",
            filter: `league_id=eq.${leagueId}`,
          },
          (payload) => {
            const record = payload.new as SyncRunRecord;
            if (record?.id) accept(toSyncRun(record));
          },
        )
        .subscribe();

      close = () => void supabase.removeChannel(channel);
    })();

    return () => {
      cancelled = true;
      close?.();
    };
  }, [leagueId, accept]);

  const live = run?.status === "running";

  useEffect(() => {
    if (!live) return;

    const poll = async () => {
      const response = await fetch(`/api/sync?leagueId=${leagueId}`, {
        cache: "no-store",
      });
      if (!response.ok) return;

      const payload = (await response.json()) as { run: SyncRun | null };
      if (payload.run) accept(payload.run);
    };

    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, leagueId, accept]);

  // A stage killed mid-flight cannot mark itself failed, so "running but gone
  // quiet" is its own state — and the one the retry button exists for.
  useEffect(() => {
    if (!run || run.status !== "running") {
      setStalled(false);
      return;
    }

    const check = () => setStalled(isStalled(run));
    check();
    const timer = setInterval(check, 5_000);
    return () => clearInterval(timer);
  }, [run]);

  const call = useCallback(async (body: Record<string, string>) => {
    setStarting(true);
    try {
      await post(body);
    } finally {
      setStarting(false);
    }
  }, []);

  const start = useCallback(() => call({ leagueId }), [call, leagueId]);
  const retry = useCallback(
    () => (run ? call({ runId: run.id }) : Promise.resolve()),
    [call, run],
  );

  return { run, starting, stalled, start, retry };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BatchStatus } from "@/app/api/sync/all/route";

/** Often enough to feel live, rarely enough not to poll a stage to death. */
const POLL_MS = 2_500;

/**
 * Refreshes every board, one after another.
 *
 * The leagues are synced sequentially rather than at once, and the button says
 * so while it works — "2 of 5" is the honest reading of a queue, and a spinner
 * that sat there for four minutes with no count would look stuck. Sequential
 * is not a limitation to apologise for either: stages 2–5 pull global
 * reference data, so the first league pays for the shared work and the rest
 * find it already on disk.
 *
 * Polled rather than subscribed. The per-league screens already stream their
 * own run over Realtime; this only needs to know which board is being worked
 * on, and a channel that has to re-subscribe every time the run id changes —
 * which is every league — would be more moving parts for a coarser answer.
 */
export function SyncAllButton({
  leagueCount,
  variant = "outline",
}: {
  leagueCount: number;
  variant?: "default" | "outline" | "ghost";
}) {
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  /**
   * Whether this component has seen a run in flight.
   *
   * The reload below is conditional on it, and has to be. Every mount polls
   * once to pick up a batch already running, and on a quiet page that first
   * answer is "nothing is running" — which, reloaded unconditionally, is a
   * page that refreshes itself forever. Only the transition from running to
   * finished means new data landed behind the screen.
   */
  const sawRunning = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/all", { cache: "no-store" });
      if (!response.ok) return;

      const next = (await response.json()) as BatchStatus;
      if (!mounted.current) return;

      setStatus(next);

      if (next.running) {
        sawRunning.current = true;
        timer.current = setTimeout(poll, POLL_MS);
        return;
      }

      // The last league landed. The page behind this button was rendered
      // before any of it ran, so it is now describing a stale board.
      if (sawRunning.current) {
        sawRunning.current = false;
        window.location.reload();
      }
      // Nothing running and nothing was: stop. No timer is set, so the poll
      // chain ends here until the button is pressed again.
    } catch {
      // A dropped poll is not a failed sync — the runs are server-side and
      // carry on regardless. Try again on the next tick.
      if (mounted.current) timer.current = setTimeout(poll, POLL_MS);
    }
  }, []);

  const start = async () => {
    setStarting(true);
    try {
      const response = await fetch("/api/sync/all", {
        method: "POST",
        cache: "no-store",
      });
      const body = (await response.json()) as {
        total?: number;
        started?: number;
        note?: string;
        error?: string;
      };

      if (!response.ok) {
        toast.error(body.error ?? "Could not start the sync.");
        return;
      }

      if (body.note) {
        toast.info(body.note);
        return;
      }

      toast.success(
        `Syncing ${body.total} board${body.total === 1 ? "" : "s"}, one at a time.`,
      );
      // Awaited so the button goes straight from "starting" to naming the
      // league it is on, rather than flicking back to idle in between.
      await poll();
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      if (mounted.current) setStarting(false);
    }
  };

  // Pick up a batch already in flight — started from the other page, or before
  // a reload. Runs once; the poll chain keeps itself going from there.
  useEffect(() => {
    void poll();
  }, [poll]);

  const running = status?.running ?? null;
  const batch = status?.batch ?? null;
  const busy = starting || running !== null;

  const label = running
    ? batch
      ? `${batch.done + 1} of ${batch.total} · ${running.leagueName}`
      : running.leagueName
    : `Sync all ${leagueCount}`;

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={busy || leagueCount === 0}
      onClick={start}
      title={running?.stageLabel ?? undefined}
    >
      {busy ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : (
        <RefreshCw aria-hidden />
      )}
      <span className="max-w-[22ch] truncate">{label}</span>
    </Button>
  );
}

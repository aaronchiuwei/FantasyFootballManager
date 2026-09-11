"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Stencil } from "@/components/board/panel";
import { cn } from "@/lib/utils";

/**
 * The one thing on this screen that is not a server render.
 *
 * Every other reading in this app is as fresh as the last time somebody
 * pressed sync, and that is the right bargain everywhere else: a trade value
 * does not move while you are looking at it. A score does. A matchup screen
 * that needs a button pressed to tell you your flex just scored is a screen
 * nobody watches, so during a live week — and only during a live week — this
 * asks for the two things that move and re-renders the page around them.
 *
 * It starts **paused**. The screen upstairs only mounts this at all on a day
 * with football on it, in a week that has started — but "we could poll" and
 * "please poll" are different statements, and a page that begins making
 * requests against somebody's Yahoo account because they opened a tab is
 * making the second one on their behalf. The choice is remembered, so turning
 * it on is a thing you do once a Sunday rather than once a page.
 *
 * Three more rules keep it from being a nuisance once it is on. It stops when
 * the tab is hidden, because nobody is reading a background tab and the
 * request still costs somebody's rate limit. It gives up after three
 * consecutive failures rather than retrying into a wall. And it can be paused
 * again at any point.
 */

/** How often to ask. The server floors it at 45s regardless. */
const EVERY_MS = 60_000;

/** After this many failures in a row, stop and say so. */
const GIVE_UP_AFTER = 3;

const REMEMBERED = "ffm:matchup-live";

function ago(at: number | null): string {
  if (at === null) return "not yet";
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function LiveRefresh({
  leagueId,
  week,
}: {
  leagueId: string;
  week: number;
}) {
  const router = useRouter();

  const [running, setRunning] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-rendered on a slow clock so "12s ago" does not sit there saying "just
  // now" for a minute. Nothing is fetched by this; it only ages the label.
  const [, tick] = useState(0);

  const failures = useRef(0);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(REMEMBERED) === "on") setRunning(true);
    } catch {
      // A browser with site data blocked still gets a working page, paused.
    }
  }, []);

  const pull = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/leagues/${leagueId}/live`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week }),
      });

      const report = (await response.json()) as { ok?: boolean; error?: string };

      if (!report.ok) {
        failures.current += 1;
        setError(report.error ?? "Could not refresh.");
        if (failures.current >= GIVE_UP_AFTER) setRunning(false);
        return;
      }

      failures.current = 0;
      setError(null);
      setAt(Date.now());
      // The server components above re-run against the rows just written. No
      // state is lost: the page has none, which is what made it worth keeping
      // a server render.
      router.refresh();
    } catch {
      failures.current += 1;
      setError("Could not reach the server.");
      if (failures.current >= GIVE_UP_AFTER) setRunning(false);
    } finally {
      setBusy(false);
    }
  }, [leagueId, week, router]);

  useEffect(() => {
    if (!running) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      void pull();
      timer = setInterval(() => void pull(), EVERY_MS);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () =>
      document.visibilityState === "visible" ? start() : stop();

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running, pull]);

  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(timer);
  }, []);

  const toggle = () => {
    const next = !running;
    setRunning(next);
    if (next) failures.current = 0;
    try {
      window.localStorage.setItem(REMEMBERED, next ? "on" : "off");
    } catch {
      // Not remembering the choice is better than not honouring it.
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            error
              ? "bg-destructive"
              : running
                ? "animate-pulse bg-grease motion-reduce:animate-none"
                : "bg-chalk-dim",
          )}
        />
        <Stencil className={cn(error && "text-destructive")}>
          {error
            ? failures.current >= GIVE_UP_AFTER
              ? `Live updates stopped · ${error}`
              : `Retrying · ${error}`
            : running
              ? `Live · updated ${ago(at)}`
              : at === null
                ? "Games on today · live updates off"
                : `Paused · updated ${ago(at)}`}
        </Stencil>
      </span>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => void pull()}
        disabled={busy}
        aria-label="Refresh now"
      >
        <RefreshCw aria-hidden className={cn(busy && "animate-spin")} />
        Refresh
      </Button>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={toggle}
        aria-label={running ? "Pause live updates" : "Turn on live updates"}
      >
        {running ? <Pause aria-hidden /> : <Play aria-hidden />}
        {running ? "Pause" : at === null ? "Go live" : "Resume"}
      </Button>
    </div>
  );
}

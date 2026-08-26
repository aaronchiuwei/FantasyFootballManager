"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  progressOf,
  resumeFrom,
  STAGE_LABELS,
  type SyncRun,
} from "@/lib/sync/plan";

import { ProgressGauge } from "./progress-gauge";
import { StageChecklist } from "./stage-checklist";
import { useLeagueSync } from "./use-league-sync";

/** A run that just finished is still interesting; an old one is a footnote. */
const RECENT_MS = 2 * 60 * 1000;

function relative(timestamp: string): string {
  const seconds = (Date.now() - Date.parse(timestamp)) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function headline(run: SyncRun | null, stalled: boolean): string {
  if (!run) return "Never synced";
  if (stalled) return "The sync stopped responding";

  if (run.status === "running") {
    const active = run.stages.find((stage) => stage.status === "running");
    return active ? `Syncing: ${STAGE_LABELS[active.id]}` : "Starting the sync";
  }

  if (run.status === "failed") {
    const failed = run.stages.find((stage) => stage.status === "failed");
    return failed ? `Failed at ${STAGE_LABELS[failed.id]}` : "The last sync failed";
  }

  return `Last synced ${relative(run.finishedAt ?? run.startedAt)}`;
}

/**
 * Requirement 2, as one button: Yahoo, Sleeper, the trade market, identity and
 * values, refreshed together.
 *
 * The eight stages behind it are shown rather than hidden. A job that takes
 * half a minute has to say what it is doing, and a stage that fails has to be
 * nameable — that is what makes "retry from the failed stage" a sentence the
 * user can act on instead of a spinner they have to trust.
 */
export function SyncPanel({
  leagueId,
  initialRun,
}: {
  leagueId: string;
  initialRun: SyncRun | null;
}) {
  const { run, starting, stalled, start, retry } = useLeagueSync(
    leagueId,
    initialRun,
  );
  const [expanded, setExpanded] = useState(false);

  // "How long ago" is not knowable on the server, and a checklist that appears
  // between the server's render and the client's is a hydration mismatch. So
  // recency is decided after mount and never during SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const live = run?.status === "running" && !stalled;
  const broken = run?.status === "failed" || stalled;
  const recent =
    mounted &&
    run !== null &&
    Date.now() - Date.parse(run.finishedAt ?? run.startedAt) < RECENT_MS;

  const progress = run ? progressOf(run.stages) : 0;
  const showChecklist = run !== null && (live || broken || recent || expanded);
  const resume = run ? resumeFrom(run.stages) : null;
  const needsReauth = broken && /Yahoo link expired/i.test(run?.error ?? "");

  const tone = broken ? "destructive" : run?.status === "succeeded" ? "success" : "primary";

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ProgressGauge progress={run ? progress : 0} tone={run ? tone : "muted"}>
              {live ? (
                <span className="font-mono text-[10px] tabular-nums">
                  {Math.round(progress * 100)}
                </span>
              ) : broken ? (
                <X className="size-4 text-destructive" aria-hidden />
              ) : run?.status === "succeeded" ? (
                <Check className="size-4 text-success" aria-hidden />
              ) : (
                <RefreshCw className="size-4 text-muted-foreground" aria-hidden />
              )}
            </ProgressGauge>

            <div className="space-y-0.5">
              <p className="text-sm font-medium">One-button sync</p>
              <p
                className="text-sm text-muted-foreground"
                suppressHydrationWarning
              >
                {headline(run, stalled)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {run && !live ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded ? "Hide" : "Details"}
              </Button>
            ) : null}

            {broken && resume ? (
              <Button size="sm" disabled={starting} onClick={() => void retry()}>
                {starting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-4" aria-hidden />
                )}
                Retry from {STAGE_LABELS[resume]}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={starting || live}
                onClick={() => void start()}
              >
                {starting || live ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="size-4" aria-hidden />
                )}
                {live ? "Syncing…" : "Sync"}
              </Button>
            )}
          </div>
        </div>

        {needsReauth ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Yahoo needs to be reconnected</AlertTitle>
            <AlertDescription>
              The refresh token was revoked or expired.{" "}
              <Link href="/leagues" className="underline underline-offset-2">
                Reconnect Yahoo
              </Link>{" "}
              and run the sync again.
            </AlertDescription>
          </Alert>
        ) : null}

        {showChecklist && run ? (
          <>
            <Separator />
            <StageChecklist stages={run.stages} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

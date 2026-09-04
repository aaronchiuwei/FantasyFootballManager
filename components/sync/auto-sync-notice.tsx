"use client";

import { Loader2, TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Stencil } from "@/components/board/panel";
import { STAGE_LABELS, type SyncRun } from "@/lib/sync/plan";

import { useLeagueSync } from "./use-league-sync";

/**
 * What a hand-kept league shows instead of a sync button.
 *
 * A manual league is not synced on demand — every edit marks it for
 * recomputation and the next page load starts one — so there is nothing for a
 * button to do that has not already been done. What is left is the two states
 * the user still has to know about.
 *
 * While a run is in flight it says so, because the values on the screen behind
 * it are the *previous* ones and a page that silently changes its numbers a
 * few seconds after loading is worse than one that warns you.
 *
 * When a run has failed it offers to try again, and this is the deliberate
 * exception to "no sync button". The automatic path does not retry a failure —
 * it would start a doomed run on every page view — so without this the league
 * would be stuck with no way back. A control that appears only when something
 * is broken is not the thing that was asked to go away.
 */
export function AutoSyncNotice({
  leagueId,
  initialRun,
}: {
  leagueId: string;
  initialRun: SyncRun | null;
}) {
  const { run, starting, stalled, retry } = useLeagueSync(leagueId, initialRun);

  const failed = run?.status === "failed" || stalled;
  const running = !failed && (starting || run?.status === "running");

  if (failed) {
    const stage = run?.stages.find((entry) => entry.status === "failed");

    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>
          {stalled
            ? "The last refresh stopped responding"
            : `${stage ? STAGE_LABELS[stage.id] : "The refresh"} failed`}
        </AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>
            {run?.error ??
              "Values, needs and trade suggestions may be out of date until this succeeds."}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!running) return null;

  const active = run?.stages.find((entry) => entry.status === "running");

  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
      Recomputing this board
      {active ? (
        <Stencil>{STAGE_LABELS[active.id]}</Stencil>
      ) : null}
    </p>
  );
}

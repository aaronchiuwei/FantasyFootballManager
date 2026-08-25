"use client";

import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { progressOf, STAGE_LABELS, type SyncRun } from "@/lib/sync/plan";

import { useLeagueSync } from "./use-league-sync";

/**
 * The same sync, without the checklist — for pages that show one slice of what
 * a sync produces and just need a way to refresh it. Progress still shows,
 * because a button that silently does nothing for thirty seconds is worse than
 * no button.
 */
export function SyncButton({
  leagueId,
  initialRun,
  label = "Sync",
  variant,
}: {
  leagueId: string;
  initialRun: SyncRun | null;
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const { run, starting, stalled, start, retry } = useLeagueSync(
    leagueId,
    initialRun,
  );

  const live = run?.status === "running" && !stalled;
  const broken = run?.status === "failed" || stalled;
  const active = run?.stages.find((stage) => stage.status === "running");

  return (
    <Button
      size="sm"
      variant={variant}
      disabled={starting || live}
      onClick={() => void (broken ? retry() : start())}
    >
      {starting || live ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-4" aria-hidden />
      )}
      {live
        ? `${active ? STAGE_LABELS[active.id] : "Syncing"}… ${Math.round(progressOf(run.stages) * 100)}%`
        : broken
          ? "Retry sync"
          : label}
    </Button>
  );
}

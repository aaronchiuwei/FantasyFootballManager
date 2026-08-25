"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { STAGE_LABELS, type SyncRun } from "@/lib/sync/plan";
import { useSyncRun, type SyncRunState } from "@/lib/sync/use-sync-run";

/** How many stage warnings are worth a toast before it becomes wallpaper. */
const MAX_TOASTED_WARNINGS = 3;

/**
 * The sync hook plus the app's reaction to it: a toast when a run settles, and
 * a router refresh so the server-rendered counts on the page catch up with
 * what the sync just wrote.
 */
export function useLeagueSync(
  leagueId: string,
  initialRun: SyncRun | null,
): SyncRunState {
  const router = useRouter();

  const onSettled = useCallback(
    (run: SyncRun) => {
      if (run.status === "succeeded") {
        const summary = run.stages.find((stage) => stage.id === "compute");
        toast.success("League synced.", {
          description: summary?.detail ?? undefined,
        });

        const warnings = run.stages.flatMap((stage) => stage.warnings);
        for (const warning of warnings.slice(0, MAX_TOASTED_WARNINGS)) {
          toast.warning(warning);
        }
      } else {
        const failed = run.stages.find((stage) => stage.status === "failed");
        toast.error(
          failed ? `${STAGE_LABELS[failed.id]} failed` : "The sync failed.",
          { description: run.error ?? undefined },
        );
      }

      router.refresh();
    },
    [router],
  );

  const state = useSyncRun(leagueId, initialRun, { onSettled });

  const guard = (action: () => Promise<void>) => async () => {
    try {
      await action();
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "The sync would not start.",
      );
    }
  };

  return {
    ...state,
    start: guard(state.start),
    retry: guard(state.retry),
  };
}

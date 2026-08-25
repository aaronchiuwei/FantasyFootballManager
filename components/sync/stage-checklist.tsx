import {
  AlertTriangle,
  Check,
  Circle,
  Loader2,
  Minus,
  X,
} from "lucide-react";

import { STAGES, type StageState, type StageStatus } from "@/lib/sync/plan";
import { cn } from "@/lib/utils";

function StageIcon({ status }: { status: StageStatus }) {
  const base = "size-3.5";

  switch (status) {
    case "running":
      return (
        <Loader2
          className={cn(base, "animate-spin text-primary motion-reduce:animate-none")}
          aria-hidden
        />
      );
    case "done":
      return <Check className={cn(base, "text-[var(--success)]")} aria-hidden />;
    case "skipped":
      return <Minus className={cn(base, "text-muted-foreground")} aria-hidden />;
    case "failed":
      return <X className={cn(base, "text-destructive")} aria-hidden />;
    default:
      return <Circle className={cn(base, "text-border")} aria-hidden />;
  }
}

function duration(stage: StageState): string | null {
  if (!stage.startedAt || !stage.finishedAt) return null;
  const ms = Date.parse(stage.finishedAt) - Date.parse(stage.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The staged checklist §9 describes: eight rows, each reporting what it
 * actually did rather than a percentage. Warnings sit under the stage that
 * raised them, which is the durable home the value engine's invariant checks
 * were waiting for.
 */
export function StageChecklist({ stages }: { stages: StageState[] }) {
  const byId = new Map(stages.map((stage) => [stage.id, stage]));

  return (
    <ol className="space-y-2">
      {STAGES.map((meta) => {
        const stage = byId.get(meta.id);
        const status = stage?.status ?? "pending";
        const elapsed = stage ? duration(stage) : null;

        return (
          <li key={meta.id} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 flex size-4 items-center justify-center">
              <StageIcon status={status} />
            </span>

            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={cn(
                    "font-medium",
                    status === "pending" && "text-muted-foreground",
                    status === "failed" && "text-destructive",
                  )}
                >
                  {meta.label}
                </span>
                {elapsed ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {elapsed}
                  </span>
                ) : null}
              </div>

              <p
                className={cn(
                  "text-xs",
                  status === "failed"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {stage?.error ??
                  stage?.detail ??
                  (status === "running" ? `${meta.description}…` : meta.description)}
              </p>

              {(stage?.warnings ?? []).map((warning) => (
                <p
                  key={warning}
                  className="flex items-start gap-1.5 text-xs text-[var(--warning)]"
                >
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>{warning}</span>
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

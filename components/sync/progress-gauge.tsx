import { cn } from "@/lib/utils";

/**
 * The sync's progress as a level gauge cut into the board.
 *
 * A ring is a foreign object here, and it was also the less informative shape:
 * this fills from the bottom against eight etched divisions, one per stage, so
 * "three stages in" is countable rather than a fraction of an arc nobody can
 * measure by eye.
 *
 * Determinate because the pipeline knows exactly how many stages it has. A
 * spinner would be a lie about a job that legitimately takes 20 to 40 seconds.
 */
export function ProgressGauge({
  progress,
  className,
  tone = "primary",
  children,
}: {
  progress: number;
  className?: string;
  tone?: "primary" | "success" | "destructive" | "muted";
  children?: React.ReactNode;
}) {
  const fill = {
    primary: "bg-primary",
    success: "bg-success",
    destructive: "bg-destructive",
    muted: "bg-muted-foreground",
  }[tone];

  const pct = Math.min(1, Math.max(0, progress)) * 100;

  return (
    <div
      className={cn(
        "relative size-11 shrink-0 overflow-hidden rounded-xs",
        "bg-[color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]",
        className,
      )}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Sync progress"
    >
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 opacity-30",
          "transition-[height] duration-(--motion-slow) ease-(--ease-out) motion-reduce:transition-none",
          fill,
        )}
        style={{ height: `${pct}%` }}
      />
      {/* Eight divisions, one per stage of the pipeline. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[repeating-linear-gradient(to_top,color-mix(in_oklch,var(--channel-lip)_38%,transparent)_0,color-mix(in_oklch,var(--channel-lip)_38%,transparent)_1px,transparent_1px,transparent_12.5%)]"
      />
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

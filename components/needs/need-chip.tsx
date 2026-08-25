import { PositionBadge } from "@/components/values/position-badge";
import { cn } from "@/lib/utils";

/**
 * One line of §7's needs vector, as a chip: the position, and how far from the
 * league it sits.
 *
 * The number shown is the z-score in standard deviations rather than the raw
 * points behind it, for the same reason the radar's axes are: points are not
 * comparable across positions, and "0.8 above the league" is a claim a manager
 * can act on where "412 projected points" is not.
 */
export function NeedChip({
  position,
  z,
  kind,
  className,
}: {
  position: string;
  /** Positive is good on both readings: a need's z is its `need`, not its z-score. */
  z: number;
  kind: "need" | "surplus";
  className?: string;
}) {
  return (
    <span
      title={
        kind === "need"
          ? `${position} is ${z.toFixed(1)} standard deviations below this league`
          : `${position} depth is ${z.toFixed(1)} standard deviations above this league`
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-4xl border px-2 py-0.5",
        kind === "need"
          ? "border-warning/40 bg-warning/10"
          : "border-success/40 bg-success/10",
        className,
      )}
    >
      <PositionBadge position={position} className="h-4 w-8 text-[0.625rem]" />
      <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
        {z >= 0 ? "+" : "−"}
        {Math.abs(z).toFixed(1)}
      </span>
    </span>
  );
}

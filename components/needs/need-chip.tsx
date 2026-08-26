import { PositionBadge } from "@/components/values/position-badge";
import { cn } from "@/lib/utils";

/**
 * One line of the needs vector, as a stamped chip: the position core, and how
 * far from the league it sits.
 *
 * The number shown is the z-score in standard deviations rather than the raw
 * points behind it, for the same reason the radar's axes are: points are not
 * comparable across positions, and "0.8 above the league" is a claim a manager
 * can act on where "412 projected points" is not.
 *
 * The sign is spelled out and the colour is only the second carrier, so a
 * greyscale reading still tells a need from a surplus.
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
        "inline-flex items-center gap-1.5 rounded-xs py-0.5 pr-2 pl-0.5",
        kind === "need"
          ? "bg-warning/14 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--warning)_30%,transparent)]"
          : "bg-success/14 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--success)_30%,transparent)]",
        className,
      )}
    >
      <PositionBadge position={position} className="h-4 w-8 text-[0.5rem]" />
      <span
        data-numeric
        className={cn(
          "stencil tabular-nums",
          kind === "need" ? "text-warning" : "text-success",
        )}
      >
        {z >= 0 ? "+" : "-"}
        {Math.abs(z).toFixed(1)}
      </span>
    </span>
  );
}

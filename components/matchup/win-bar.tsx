import { cn } from "@/lib/utils";

/**
 * The week's odds, drawn as one divided bar.
 *
 * Two figures that sum to 100 are one quantity, not two, so they get one bar
 * with a seam in it rather than a gauge each. The seam is the reading: how far
 * it sits from the centre mark *is* the margin, and a reader who never looks
 * at the numbers still knows who is winning and by how comfortably.
 *
 * The centre mark is drawn because a probability bar without one is a fill of
 * unknown meaning — 60% and 40% look alike at a glance, and the whole point of
 * the thing is which side of even it fell on.
 *
 * Both sides are filled, which matters more than it looks. A bar drawn as one
 * fill on an empty track cannot distinguish a side with no chance from a
 * matchup with no data: 0% and "nothing here" are the same picture. Painting
 * the second side too means the seam always exists somewhere, and a side that
 * has lost reads as a bar pushed hard against its end rather than as a blank.
 */

/**
 * The chance as a whole number, never rounded to a certainty it has not
 * earned.
 *
 * A 99.6% favourite is not a winner, and printing "100%" over a game with a
 * flex still to play is the single fastest way to make a manager stop
 * believing the number. Certainty is reserved for the case that is actually
 * certain: nobody left to play, which the model returns as exactly 1 or 0.
 */
export function chancePercent(probability: number): number {
  if (probability >= 1) return 100;
  if (probability <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(probability * 100)));
}

/** What to print over a side: a verdict once it is one, a chance until then. */
export function chanceLabel(probability: number): string {
  if (probability >= 1) return "Won";
  if (probability <= 0) return "Lost";
  return `${chancePercent(probability)}%`;
}

export function WinBar({
  probability,
  leftLabel,
  rightLabel,
  slim = false,
  className,
}: {
  /** The chance the left side outscores the right. */
  probability: number;
  leftLabel: string;
  rightLabel: string;
  /**
   * The scoreboard form: the track alone, with whatever labels the row around
   * it already carries. Same bar, same reading — a list of twelve of these is
   * scanned by seam position, and twelve legends would bury the thing.
   */
  slim?: boolean;
  className?: string;
}) {
  const pct = chancePercent(probability);
  const decided = probability >= 1 || probability <= 0;

  return (
    <div data-slot="win-bar" className={cn("min-w-0", className)}>
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-xs",
          slim ? "h-1.5" : "h-3",
          "bg-[color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
          "shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]",
        )}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Chance ${leftLabel} outscores ${rightLabel}`}
      >
        <div
          className="absolute inset-y-0 left-0 bg-grease transition-[width] duration-(--motion-slow) ease-(--ease-out)"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-chalk-dim/55 transition-[width] duration-(--motion-slow) ease-(--ease-out)"
          style={{ width: `${100 - pct}%` }}
        />
        {/* Counted in tenths, like every other measured bar in this app. */}
        {slim ? null : <div aria-hidden className="graticule absolute inset-0" />}
        {/* Even money is a real mark on the board, not the absence of fill. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-chalk/55"
        />
      </div>

      {slim ? null : (
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              data-numeric
              className="font-plate text-sm font-bold tabular-nums text-grease"
            >
              {chanceLabel(probability)}
            </span>
            <span className="stencil truncate text-chalk-dim">{leftLabel}</span>
          </span>

          {decided ? null : (
            <span className="stencil shrink-0 text-chalk-dim">Even</span>
          )}

          <span className="flex min-w-0 items-baseline justify-end gap-1.5">
            <span className="stencil truncate text-chalk-dim">{rightLabel}</span>
            <span
              data-numeric
              className="font-plate text-sm font-bold tabular-nums text-foreground"
            >
              {chanceLabel(1 - probability)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

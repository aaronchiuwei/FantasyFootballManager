import type { ScheduleStrength, SosTier } from "@/lib/schedule/sos";
import { cn } from "@/lib/utils";

/**
 * One player's schedule, stamped.
 *
 * The figure is points per game rather than the standard score behind it,
 * because that is the form a manager can spend: "his opponents give up 2.3
 * more points a game to receivers than the average defense" is a claim about
 * this season, where "+0.58 sd" is a claim about the arithmetic. The rank is
 * printed beside it because seventeen games regress almost any slate toward
 * the middle, and a small number with no scale reads as no difference when it
 * is sometimes a real one.
 *
 * Colour is the second carrier, never the first: the chip always prints the
 * word and the sign, so it survives a greyscale screenshot and a colour-blind
 * reader, exactly as the provenance stamp and the needs chip do.
 */

const TIER_WORDS: Record<SosTier, string> = {
  easy: "Soft",
  even: "Level",
  hard: "Tough",
};

const TIER_STYLES: Record<SosTier, string> = {
  easy: "bg-success/14 text-success",
  even: "bg-[color-mix(in_oklch,var(--channel)_55%,transparent)] text-chalk-dim",
  hard: "bg-warning/14 text-warning",
};

function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  const ones = rank % 10;
  return `${rank}${ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}

function signed(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}`;
}

/** The sentence the chip carries on hover, and its only home on a phone. */
export function sosDescription(
  reading: ScheduleStrength,
  windowLabel: string,
): string {
  const byes =
    reading.byes.length === 0
      ? "No bye in this window."
      : `Bye in week ${reading.byes.join(", ")}.`;

  const direction =
    Math.abs(reading.pointsPerGame) < 0.05
      ? "as many points"
      : `${Math.abs(reading.pointsPerGame).toFixed(1)} ${reading.pointsPerGame > 0 ? "more" : "fewer"} points`;

  return [
    `${windowLabel}: the ${ordinal(reading.rank)} softest slate of ${reading.outOf} for a ${reading.position}.`,
    `Over ${reading.games} game${reading.games === 1 ? "" : "s"} his opponents allow ${direction} per game than the average defense, in this league's scoring.`,
    byes,
  ].join(" ");
}

export function SosChip({
  reading,
  windowLabel,
  showRank = true,
  className,
}: {
  /** Null for a free agent, a kicker or a defense: none of them has a reading. */
  reading: ScheduleStrength | null;
  windowLabel: string;
  showRank?: boolean;
  className?: string;
}) {
  if (!reading) {
    return (
      <span
        data-numeric
        title="No schedule reading. Only quarterbacks, runners, receivers and tight ends on an NFL roster are graded."
        className={cn("stencil tabular-nums text-chalk-dim", className)}
      >
        --
      </span>
    );
  }

  return (
    <span
      title={sosDescription(reading, windowLabel)}
      data-slot="sos-chip"
      data-tier={reading.tier}
      className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
    >
      <span
        className={cn(
          "stencil inline-flex h-5 shrink-0 items-center gap-1 rounded-xs px-1.5 text-[0.5625rem]",
          TIER_STYLES[reading.tier],
        )}
      >
        {TIER_WORDS[reading.tier]}
        <span data-numeric className="tabular-nums">
          {signed(reading.pointsPerGame)}
        </span>
      </span>

      {showRank ? (
        <span
          data-numeric
          className="stencil shrink-0 tabular-nums text-chalk-dim"
        >
          {reading.rank}/{reading.outOf}
        </span>
      ) : null}
    </span>
  );
}

"use client";

import { cn } from "@/lib/utils";

export type BeamTone = "fair" | "tilted" | "lopsided" | "idle";

/**
 * Full-color class lists, written out rather than composed, because Tailwind
 * scans source text — a class built from a variable is a class that does not
 * exist. The colors themselves are the `--verdict-*` tokens Phase 0 declared
 * for exactly this component.
 */
const TONES: Record<BeamTone, { beam: string; pan: string; glow: string }> = {
  fair: {
    beam: "stroke-verdict-fair",
    pan: "fill-verdict-fair/15 stroke-verdict-fair",
    glow: "fill-verdict-fair/10",
  },
  tilted: {
    beam: "stroke-verdict-tilted",
    pan: "fill-verdict-tilted/15 stroke-verdict-tilted",
    glow: "fill-verdict-tilted/10",
  },
  lopsided: {
    beam: "stroke-verdict-lopsided",
    pan: "fill-verdict-lopsided/15 stroke-verdict-lopsided",
    glow: "fill-verdict-lopsided/10",
  },
  idle: {
    beam: "stroke-border",
    pan: "fill-muted stroke-border",
    glow: "fill-transparent",
  },
};

const WIDTH = 360;
const HEIGHT = 148;
const CX = WIDTH / 2;
const CY = 56;
/** Half the beam. */
const ARM = 132;
/** How far the beam swings at a fully tipped verdict. Enough to read across a room. */
const MAX_DEGREES = 12;
const HANGER = 20;

/**
 * §10's signature interaction: "an animated balance beam tipping by `pct`".
 *
 * The tilt is the verdict — not decoration on top of it — so the geometry is
 * computed from the analysis rather than eyeballed, and the heavier side goes
 * *down*, the way a scale does. Pans hang level at the arm's ends, which is
 * why their positions are solved here instead of being rotated along with the
 * beam: a bowl that tips its contents out is a scale nobody trusts.
 *
 * Motion is a CSS transform transition, so `motion-reduce` turns the whole
 * thing into an instant, still, and equally readable diagram (§10).
 */
export function BalanceBeam({
  tilt,
  tone,
  className,
}: {
  /** −1 … +1, from `TradeVerdict.tilt`. Positive tips the left (A) side down. */
  tilt: number;
  tone: BeamTone;
  className?: string;
}) {
  const clamped = Math.max(-1, Math.min(1, tilt));
  // SVG rotation is clockwise-positive, and the left arm has to fall when side
  // A is heavier — hence the sign flip.
  const degrees = -clamped * MAX_DEGREES;
  const radians = (degrees * Math.PI) / 180;

  const dx = ARM * Math.cos(radians);
  const dy = ARM * Math.sin(radians);
  const ends = {
    a: { x: CX - dx, y: CY - dy },
    b: { x: CX + dx, y: CY + dy },
  };

  const style = TONES[tone];
  const swing =
    "transition-transform duration-[var(--motion-slow)] ease-out motion-reduce:transition-none";

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("h-32 w-full", className)}
      // Hidden rather than labelled: the verdict, the margin and both totals
      // are already text directly above and below it, so a description here
      // would be a screen reader saying the same thing three times. It had a
      // `role="img"` alongside this, which is a contradiction — an image with
      // no accessible name that is also not in the tree.
      aria-hidden
    >
      {/* Plinth and fulcrum: the fixed half of the picture. */}
      <path
        d={`M ${CX} ${CY + 6} L ${CX - 22} ${HEIGHT - 22} L ${CX + 22} ${HEIGHT - 22} Z`}
        className="fill-muted"
      />
      <line
        x1={CX - 52}
        y1={HEIGHT - 21}
        x2={CX + 52}
        y2={HEIGHT - 21}
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-border"
      />

      <g
        className={swing}
        style={{
          transform: `rotate(${degrees}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transformBox: "view-box",
        }}
      >
        <line
          x1={CX - ARM}
          y1={CY}
          x2={CX + ARM}
          y2={CY}
          strokeWidth="4"
          strokeLinecap="round"
          className={style.beam}
        />
      </g>

      <circle cx={CX} cy={CY} r="7" className={cn("stroke-2", style.pan)} />

      {(["a", "b"] as const).map((side) => (
        <g
          key={side}
          className={swing}
          style={{
            transform: `translate(${ends[side].x - CX}px, ${ends[side].y - CY}px)`,
            transformOrigin: `${CX}px ${CY}px`,
            transformBox: "view-box",
          }}
        >
          <line
            x1={CX}
            y1={CY}
            x2={CX}
            y2={CY + HANGER}
            strokeWidth="1.5"
            className="stroke-border"
          />
          <path
            d={`M ${CX - 34} ${CY + HANGER} L ${CX + 34} ${CY + HANGER} L ${CX + 24} ${CY + HANGER + 16} L ${CX - 24} ${CY + HANGER + 16} Z`}
            strokeWidth="2"
            strokeLinejoin="round"
            className={style.pan}
          />
        </g>
      ))}
    </svg>
  );
}

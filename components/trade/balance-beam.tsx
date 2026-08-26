"use client";

import { BAND_THRESHOLDS, FULL_TILT_PCT } from "@/lib/trades/analyze";
import { cn } from "@/lib/utils";

export type BeamTone = "fair" | "tilted" | "lopsided" | "idle";

/**
 * Full-colour class lists, written out rather than composed, because Tailwind
 * scans source text and a class built from a variable is a class that does not
 * exist. The colours are the `--verdict-*` tokens declared for this component.
 */
const TONES: Record<BeamTone, { beam: string; tray: string; wire: string }> = {
  fair: {
    beam: "stroke-verdict-fair",
    tray: "fill-verdict-fair/18 stroke-verdict-fair",
    wire: "stroke-verdict-fair/55",
  },
  tilted: {
    beam: "stroke-verdict-tilted",
    tray: "fill-verdict-tilted/18 stroke-verdict-tilted",
    wire: "stroke-verdict-tilted/55",
  },
  lopsided: {
    beam: "stroke-verdict-lopsided",
    tray: "fill-verdict-lopsided/18 stroke-verdict-lopsided",
    wire: "stroke-verdict-lopsided/55",
  },
  idle: {
    beam: "stroke-chalk-dim",
    tray: "fill-transparent stroke-chalk-dim",
    wire: "stroke-chalk-dim/45",
  },
};

const WIDTH = 360;
const HEIGHT = 132;
const CX = WIDTH / 2;
const CY = 52;
/** Half the beam. */
const ARM = 134;
/** How far the beam swings at a fully tipped verdict. Enough to read across a room. */
const MAX_DEGREES = 12;
const HANGER = 22;

/**
 * The tilt is the verdict, not decoration on top of it, so the geometry is
 * computed from the analysis rather than eyeballed, and the heavier side goes
 * DOWN the way a scale does. The trays hang level at the arms' ends, which is
 * why their positions are solved here instead of being rotated with the beam:
 * a tray that tips its contents out is a scale nobody trusts.
 *
 * The instrument is machined from the board's own materials. The beam is an
 * aluminium bar with a lit top edge, the trays are short sections of channel,
 * and the fulcrum is a milled block bolted to the wall.
 *
 * Motion is a CSS transform transition, so `motion-reduce` turns the whole
 * thing into an instant, still, equally readable diagram.
 */
function Beam({ degrees, tone }: { degrees: number; tone: BeamTone }) {
  const radians = (degrees * Math.PI) / 180;
  const dx = ARM * Math.cos(radians);
  const dy = ARM * Math.sin(radians);
  const ends = {
    a: { x: CX - dx, y: CY - dy },
    b: { x: CX + dx, y: CY + dy },
  };

  const style = TONES[tone];
  const swing =
    "transition-transform duration-(--motion-slow) ease-(--ease-out) motion-reduce:transition-none";

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-28 w-full"
      // Hidden rather than laballed: the verdict, the margin and both totals
      // are already text directly around it, so a description here would be a
      // screen reader saying the same thing three times.
      aria-hidden
    >
      {/* The milled fulcrum block, bolted through to the board. */}
      <path
        d={`M ${CX} ${CY + 4} L ${CX - 20} ${HEIGHT - 14} L ${CX + 20} ${HEIGHT - 14} Z`}
        className="fill-channel"
      />
      <path
        d={`M ${CX} ${CY + 4} L ${CX - 20} ${HEIGHT - 14} L ${CX} ${HEIGHT - 14} Z`}
        className="fill-channel-lip/30"
      />
      <rect
        x={CX - 46}
        y={HEIGHT - 14}
        width={92}
        height={5}
        rx={1}
        className="fill-channel-lip/70"
      />

      <g
        className={swing}
        style={{
          transform: `rotate(${degrees}deg)`,
          transformOrigin: `${CX}px ${CY}px`,
          transformBox: "view-box",
        }}
      >
        {/* Two strokes: the bar, and the light along its top edge. */}
        <line
          x1={CX - ARM}
          y1={CY}
          x2={CX + ARM}
          y2={CY}
          strokeWidth="5"
          strokeLinecap="butt"
          className={style.beam}
        />
        <line
          x1={CX - ARM}
          y1={CY - 2}
          x2={CX + ARM}
          y2={CY - 2}
          strokeWidth="1"
          strokeLinecap="butt"
          className="stroke-channel-lip/70"
        />
      </g>

      {/* The pivot pin. */}
      <circle cx={CX} cy={CY} r="4.5" className="fill-channel-lip" />

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
            strokeWidth="1"
            className={style.wire}
          />
          {/* A tray is a short length of the same channel every rail uses. */}
          <rect
            x={CX - 30}
            y={CY + HANGER}
            width={60}
            height={13}
            rx={1}
            strokeWidth="1.5"
            className={style.tray}
          />
          <line
            x1={CX - 30}
            y1={CY + HANGER + 1}
            x2={CX + 30}
            y2={CY + HANGER + 1}
            strokeWidth="1"
            className="stroke-channel-lip/60"
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * The band ruler: the etched scale the beam is read against.
 *
 * The zones are the app's own fairness thresholds converted from margin into
 * beam travel, so the reader can see how much room is left before the verdict
 * changes its mind. This is information the numbers above do not carry:
 * "clear winner, and nearly lopsided" and "clear winner, barely" print the
 * same word.
 */
function BandRuler({ tilt, tone }: { tilt: number; tone: BeamTone }) {
  // Each band's upper bound as beam travel, from its bound as a margin.
  const evenT = BAND_THRESHOLDS.even / FULL_TILT_PCT;
  const slightT = BAND_THRESHOLDS.slight / FULL_TILT_PCT;
  const clearT = BAND_THRESHOLDS.clear / FULL_TILT_PCT;

  // Half the ruler is 50% of its width, so every span is halved.
  const half = (span: number) => `${span * 50}%`;

  const zones = [
    { key: "l-lop", w: 1 - clearT, cls: "bg-verdict-lopsided/22" },
    { key: "l-clear", w: clearT - slightT, cls: "bg-verdict-tilted/22" },
    { key: "l-slight", w: slightT - evenT, cls: "bg-verdict-fair/16" },
    { key: "l-even", w: evenT, cls: "bg-verdict-fair/32" },
    { key: "r-even", w: evenT, cls: "bg-verdict-fair/32" },
    { key: "r-slight", w: slightT - evenT, cls: "bg-verdict-fair/16" },
    { key: "r-clear", w: clearT - slightT, cls: "bg-verdict-tilted/22" },
    { key: "r-lop", w: 1 - clearT, cls: "bg-verdict-lopsided/22" },
  ];

  const markerPct = ((Math.max(-1, Math.min(1, tilt)) + 1) / 2) * 100;

  return (
    <div className="mt-1">
      <div
        className={cn(
          "relative flex h-2.5 w-full overflow-hidden rounded-xs",
          "shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]",
        )}
      >
        {zones.map((z) => (
          <span key={z.key} className={z.cls} style={{ width: half(z.w) }} />
        ))}

        {/* The grease-pencil mark, sliding to where the beam settled. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 w-0.5 -translate-x-1/2 bg-grease",
            "transition-[left] duration-(--motion-slow) ease-(--ease-out)",
            "motion-reduce:transition-none",
            tone === "idle" && "opacity-0",
          )}
          style={{ left: `${markerPct}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between">
        <span className="stencil text-[0.5625rem] text-chalk-dim">
          Lopsided
        </span>
        <span className="stencil text-[0.5625rem] text-chalk-dim">Even</span>
        <span className="stencil text-[0.5625rem] text-chalk-dim">
          Lopsided
        </span>
      </div>
    </div>
  );
}

export function BalanceBeam({
  tilt,
  tone,
  className,
}: {
  /** -1 to +1, from `TradeVerdict.tilt`. Positive tips the left (A) side down. */
  tilt: number;
  tone: BeamTone;
  className?: string;
}) {
  const clamped = Math.max(-1, Math.min(1, tilt));
  // SVG rotation is clockwise-positive, and the left arm has to fall when side
  // A is heavier, hence the sign flip.
  const degrees = -clamped * MAX_DEGREES;

  return (
    <div className={cn("w-full", className)}>
      <Beam degrees={degrees} tone={tone} />
      <BandRuler tilt={clamped} tone={tone} />
    </div>
  );
}

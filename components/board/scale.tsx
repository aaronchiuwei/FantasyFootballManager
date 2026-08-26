import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The measured scale.
 *
 * Every bar, beam and delta in this app sits on a drawn, divided, labelled
 * scale with its unit stated, so a magnitude can be read by counting divisions
 * rather than by hovering something. A bar with no scale is a decoration that
 * happens to be the right length.
 */

function formatNumber(value: number, digits = 0) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * A one-sided measured bar: zero at the left, `max` at the right, ten
 * divisions drawn across it.
 */
function ScaleBar({
  label,
  value,
  max,
  unit,
  digits = 0,
  color = "var(--grease)",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "color"> & {
  label?: React.ReactNode;
  value: number;
  max: number;
  unit?: string;
  digits?: number;
  color?: string;
}) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));

  return (
    <div data-slot="scale-bar" className={cn("min-w-0", className)} {...props}>
      {label || unit ? (
        <div className="mb-1 flex items-baseline justify-between gap-3">
          {label ? <span className="stencil text-chalk-dim">{label}</span> : null}
          <span
            data-numeric
            className="font-plate text-sm font-semibold tabular-nums text-foreground"
          >
            {formatNumber(value, digits)}
            {unit ? (
              <span className="stencil ml-1 text-chalk-dim">{unit}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          "relative h-2.5 w-full overflow-hidden rounded-xs",
          "bg-[color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
          "shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]"
        )}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={typeof label === "string" ? label : undefined}
      >
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-(--motion-slow) ease-(--ease-out)"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        {/* The divisions are drawn OVER the fill, so the reader counts the
            same ten marks whether the bar is short or long. */}
        <div aria-hidden className="graticule absolute inset-0" />
      </div>

      <div className="mt-1 flex justify-between">
        <span className="stencil text-[0.5625rem] text-chalk-dim">0</span>
        <span
          data-numeric
          className="stencil text-[0.5625rem] tabular-nums text-chalk-dim"
        >
          {formatNumber(safeMax, digits)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * A signed scale with zero at centre. The trade delta is a signed quantity, so
 * it is drawn on a signed scale: the reader sees which side of zero it fell on
 * before reading the figure.
 */
function DeltaScale({
  label,
  value,
  range,
  unit,
  digits = 0,
  positiveColor = "var(--verdict-fair)",
  negativeColor = "var(--strike)",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  label?: React.ReactNode;
  value: number;
  /** The scale runs from -range to +range. */
  range: number;
  unit?: string;
  digits?: number;
  positiveColor?: string;
  negativeColor?: string;
}) {
  const safeRange = range > 0 ? range : 1;
  const clamped = Math.max(-safeRange, Math.min(safeRange, value));
  const halfPct = (Math.abs(clamped) / safeRange) * 50;
  const positive = clamped >= 0;

  return (
    <div data-slot="delta-scale" className={cn("min-w-0", className)} {...props}>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="stencil text-chalk-dim">{label}</span>
          <span
            data-numeric
            className="font-plate text-sm font-semibold tabular-nums"
            style={{ color: positive ? positiveColor : negativeColor }}
          >
            {positive ? "+" : "-"}
            {formatNumber(Math.abs(value), digits)}
            {unit ? (
              <span className="stencil ml-1 text-chalk-dim">{unit}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          "relative h-2.5 w-full overflow-hidden rounded-xs",
          "bg-[color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
          "shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]"
        )}
      >
        <div
          className="absolute inset-y-0 transition-[width,left,right] duration-(--motion-slow) ease-(--ease-out)"
          style={{
            [positive ? "left" : "right"]: "50%",
            width: `${halfPct}%`,
            backgroundColor: positive ? positiveColor : negativeColor,
          }}
        />
        <div aria-hidden className="graticule absolute inset-0" />
        {/* Zero is a real mark on the board, not the absence of fill. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-chalk/45"
        />
      </div>

      <div className="mt-1 flex justify-between">
        <span
          data-numeric
          className="stencil text-[0.5625rem] tabular-nums text-chalk-dim"
        >
          -{formatNumber(safeRange, digits)}
        </span>
        <span className="stencil text-[0.5625rem] text-chalk-dim">0</span>
        <span
          data-numeric
          className="stencil text-[0.5625rem] tabular-nums text-chalk-dim"
        >
          +{formatNumber(safeRange, digits)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
}

export { ScaleBar, DeltaScale, formatNumber };

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * CHANNEL — an extruded aluminium rail.
 *
 * Every row of the board is one of these. A rail is the containing device in
 * this world, which is why almost nothing in the app is a bordered box: a row
 * of content sits IN a channel, and the channel's lit top lip and shadowed
 * underside do the containing that a border would otherwise have to.
 *
 * The end cap is not decoration. Every region of this board names itself, so
 * a rail always carries a stencilled label at its head and wayfinding is
 * reading rather than inference.
 */
function Rail({
  label,
  meta,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  /** Stencilled name stamped on the rail's end cap. */
  label?: React.ReactNode;
  /** Optional reading printed at the rail's far end, right-aligned. */
  meta?: React.ReactNode;
}) {
  return (
    <div
      data-slot="rail"
      className={cn(
        "rail relative flex min-w-0 items-stretch rounded-xs",
        className
      )}
      {...props}
    >
      {label ? (
        <div className="flex shrink-0 items-center gap-2 border-r border-[color-mix(in_oklch,var(--board-deep)_50%,transparent)] px-2.5 py-2">
          <span className="stencil text-chalk-dim">{label}</span>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5">
        {children}
      </div>

      {meta ? (
        <div className="flex shrink-0 items-center border-l border-[color-mix(in_oklch,var(--board-deep)_50%,transparent)] px-2.5 py-2">
          <span
            data-numeric
            className="stencil text-chalk-dim"
          >
            {meta}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A rail seen at distance: the hairline that rules the board into rows. Used
 * to separate banded regions in place of card borders.
 */
function RailLine({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="rail-line"
      className={cn("rail-line w-full", className)}
      {...props}
    />
  );
}

/**
 * An empty seat in a channel. A genuine state, not a placeholder: the board
 * shows the gap where a plate is not, which is how a war room reads "we have
 * nobody here" at a glance.
 */
function EmptySeat({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-seat"
      className={cn(
        "flex min-h-9 flex-1 items-center justify-center rounded-xs px-3 py-2",
        "bg-[color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]",
        "stencil text-chalk-dim",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Rail, RailLine, EmptySeat };

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * PLATE — an engraved laminate name plate.
 *
 * The one rule that keeps this world legible: bone means a player, and
 * nothing else on the board is bone. Panels, headers, tables and sections are
 * all board material. So a plate is never reached for as a container; it is
 * reached for when the thing on screen is a person who can be moved.
 *
 * Engraving stock is two layers. The face is bone; underneath is a coloured
 * core. The position field is where the engraver cut all the way through, so
 * the position code reads reversed out of its core colour. That is a filled
 * field, deliberately not a coloured edge stripe: a plate is made of two
 * materials, it is not a card wearing an accent border.
 */

const POSITION_INK: Record<string, string> = {
  QB: "var(--pos-qb)",
  RB: "var(--pos-rb)",
  WR: "var(--pos-wr)",
  TE: "var(--pos-te)",
  K: "var(--pos-k)",
  DEF: "var(--pos-def)",
  DST: "var(--pos-def)",
  FLEX: "var(--pos-flex)",
  BN: "var(--pos-bench)",
  BENCH: "var(--pos-bench)",
  IR: "var(--pos-bench)",
};

/** The laminate core colour for a position code, defaulting to blank stock. */
function coreColor(position?: string | null) {
  if (!position) return "var(--pos-bench)";
  return POSITION_INK[position.toUpperCase()] ?? "var(--pos-bench)";
}

function Plate({
  className,
  liftable = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Whether this plate can be picked up. Adds the lift-and-seat feedback. */
  liftable?: boolean;
}) {
  return (
    <div
      data-slot="plate"
      className={cn(
        "plate flex min-w-0 items-stretch overflow-hidden",
        liftable && "plate-liftable cursor-pointer",
        className
      )}
      {...props}
    />
  );
}

/**
 * The cut-through field carrying the position code. Sized to two or three
 * characters so a rail of plates keeps one left edge for its names.
 */
function PlateCore({
  position,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { position?: string | null }) {
  const label = children ?? position ?? "--";

  return (
    <div
      data-slot="plate-core"
      className={cn(
        "flex w-10 shrink-0 items-center justify-center self-stretch px-1",
        "shadow-[inset_-1px_0_0_color-mix(in_oklch,black_22%,transparent)]",
        className
      )}
      style={{ backgroundColor: coreColor(position) }}
      {...props}
    >
      <span className="stencil text-[0.625rem] text-pos-ink tabular-nums">
        {label}
      </span>
    </div>
  );
}

/** The engraved name. Condensed, tracked, cut below the plate surface. */
function PlateName({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="plate-name"
      className={cn(
        "engraved truncate font-plate text-[0.9375rem] font-semibold tracking-[0.015em] text-plate-ink",
        className
      )}
      {...props}
    />
  );
}

/** The second engraved line: team, bye status, roster slot, whatever qualifies. */
function PlateMeta({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="plate-meta"
      className={cn(
        "stencil truncate text-[0.625rem] text-plate-ink/75",
        className
      )}
      {...props}
    />
  );
}

/** The stamped figure at the plate's trailing edge. Always tabular. */
function PlateValue({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="plate-value"
      data-numeric
      className={cn(
        "engraved shrink-0 font-plate text-[0.9375rem] font-bold tabular-nums text-plate-ink",
        className
      )}
      {...props}
    />
  );
}

/** The plate's body between core and trailing figure. */
function PlateBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="plate-body"
      className={cn(
        "flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1.5",
        className
      )}
      {...props}
    />
  );
}

export {
  Plate,
  PlateCore,
  PlateName,
  PlateMeta,
  PlateValue,
  PlateBody,
  coreColor,
};

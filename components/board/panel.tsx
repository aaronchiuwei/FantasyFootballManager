import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * BOARD — a region of the wall.
 *
 * This is what most of the app is made of, and it is deliberately not a card.
 * A region is defined by a stencilled head, a ruled hairline under it, and the
 * space around it. No box, no border on four sides, no shadow floating it off
 * the page. That is what makes a nested card structurally impossible here:
 * there is no box to nest.
 *
 * `inset` is the exception, for a group that genuinely reads as recessed into
 * the board rather than printed on it: a summary strip, a drop target, a
 * bounded search result. It is a recess, not an elevation.
 */
function Panel({
  label,
  action,
  note,
  inset = false,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  /** The region's stencilled identifier. Every region names itself. */
  label?: React.ReactNode;
  /** Controls stamped at the region's trailing edge. */
  action?: React.ReactNode;
  /** One line under the head, for a limit or a unit the reader needs. */
  note?: React.ReactNode;
  inset?: boolean;
}) {
  return (
    <section
      data-slot="panel"
      className={cn(
        inset &&
          "rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] p-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)] sm:p-4",
        className
      )}
      {...props}
    >
      {label || action ? (
        <header
          className={cn(
            "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1",
            inset ? "pb-2" : "pb-2.5"
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            {label ? (
              <h2 className="stencil text-chalk-dim">{label}</h2>
            ) : null}
            {note ? (
              <p className="max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
                {note}
              </p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}

      {label || action ? (
        <div aria-hidden className="rail-line mb-3.5 w-full" />
      ) : null}

      {children}
    </section>
  );
}

/**
 * A stencilled identifier used outside a Panel head: on a rail end, over a
 * column of figures, beside a control. The label plate stamped on the board.
 */
function Stencil({
  className,
  tone = "dim",
  ...props
}: React.ComponentProps<"span"> & {
  tone?: "dim" | "chalk" | "grease";
}) {
  return (
    <span
      data-slot="stencil"
      className={cn(
        "stencil",
        tone === "dim" && "text-chalk-dim",
        tone === "chalk" && "text-chalk",
        tone === "grease" && "text-grease",
        className
      )}
      {...props}
    />
  );
}

/**
 * The grease pencil. Used for the one thing on a surface that the manager is
 * meant to leave with: the verdict, the warning, the limit of the search.
 * Written over the board, underlined by hand, never boxed.
 */
function GreaseNote({
  className,
  tone = "grease",
  children,
  ...props
}: React.ComponentProps<"p"> & { tone?: "grease" | "strike" | "dim" }) {
  return (
    <p
      data-slot="grease-note"
      className={cn(
        "font-plate text-sm leading-snug tracking-[0.01em]",
        tone === "grease" && "text-grease",
        tone === "strike" && "text-destructive",
        tone === "dim" && "text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
}

export { Panel, Stencil, GreaseNote };

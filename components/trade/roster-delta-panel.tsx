"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";

import { NeedChip } from "@/components/needs/need-chip";
import { Panel } from "@/components/board/panel";
import type { LineupChange } from "@/lib/needs/lineup";
import type { TradeSideKey } from "@/lib/trades/analyze";
import { cn } from "@/lib/utils";

export type RosterContextSide = {
  change: LineupChange;
  /** Positions coming in, with this team's `need` at each of them. */
  incoming: { position: string; need: number }[];
};

function points(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/**
 * §6's roster-context delta — "each team's starting-lineup projected points
 * before vs. after the trade", the thing that makes a trade *good for you* as
 * opposed to merely *even*.
 *
 * Deliberately a **second** scorer rather than a term in the first. §1.5 is the
 * rule: "trade evaluation is value-first, context-second", and Requirement 3
 * says a trade is fundamentally summed values. So nothing here moves the
 * fairness band. What it does is answer the other question a manager actually
 * has — an even trade that costs you forty projected points is still even, and
 * you should still turn it down.
 *
 * It is measured in rest-of-season projected points, which is the same
 * currency §7's needs vector and the waiver board are denominated in, and a
 * different one from the market values above it. Two scales on one screen is
 * the honest arrangement: they are answers to different questions.
 */
export function RosterDeltaPanel({
  names,
  sides,
}: {
  names: Record<TradeSideKey, string>;
  sides: Record<TradeSideKey, RosterContextSide>;
}) {
  const unprojected = sides.a.change.unprojected + sides.b.change.unprojected;
  const empty = sides.a.change.empty + sides.b.change.empty;

  return (
    <Panel
      label="Roster context"
      note="Projected starters, rest of season. A different scale from the market values above, because it answers a different question."
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {(["a", "b"] as const).map((side) => {
            const { change, incoming } = sides[side];
            const better = change.delta > 0.05;
            const worse = change.delta < -0.05;

            return (
              <div
                key={side}
                className="flex flex-col gap-1.5 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_42%,transparent)] p-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]"
              >
                <p className="stencil truncate text-chalk-dim">{names[side]}</p>

                <p
                  data-numeric
                  className="flex items-center gap-2 font-plate text-sm tabular-nums"
                >
                  <span className="text-muted-foreground">
                    {points(change.before)}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                  <span>{points(change.after)}</span>
                  <span
                    className={cn(
                      "ml-auto font-semibold",
                      better && "text-success",
                      worse && "text-destructive",
                      !better && !worse && "text-muted-foreground",
                    )}
                  >
                    {change.delta > 0 ? "+" : change.delta < 0 ? "-" : "="}
                    {points(Math.abs(change.delta))}
                  </span>
                </p>

                {incoming.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {incoming.map(({ position, need }) => (
                      <NeedChip
                        key={position}
                        position={position}
                        z={need}
                        kind={need > 0 ? "need" : "surplus"}
                      />
                    ))}
                    <span className="stencil text-chalk-dim">
                      {incoming.some(({ need }) => need > 0)
                        ? "fills a position they are thin at"
                        : "positions they are already deep in"}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {unprojected > 0 || empty > 0 ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {unprojected > 0
                ? `${unprojected} player${unprojected === 1 ? "" : "s"} in this deal ${unprojected === 1 ? "has" : "have"} no projection, so the delta cannot see ${unprojected === 1 ? "that one" : "them"}. `
                : ""}
              {empty > 0
                ? `${empty} starting slot${empty === 1 ? "" : "s"} would be left unfilled afterwards.`
                : ""}
            </span>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

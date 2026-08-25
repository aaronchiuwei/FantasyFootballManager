"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";

import { NeedChip } from "@/components/needs/need-chip";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card className="gap-0 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">Roster context</p>
          <p className="text-xs text-muted-foreground">
            projected starters, rest of season
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {(["a", "b"] as const).map((side) => {
            const { change, incoming } = sides[side];
            const better = change.delta > 0.05;
            const worse = change.delta < -0.05;

            return (
              <div key={side} className="space-y-1.5 rounded-lg border p-3">
                <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                  {names[side]}
                </p>

                <p className="flex items-center gap-2 font-mono text-sm tabular-nums">
                  <span className="text-muted-foreground">
                    {points(change.before)}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                  <span>{points(change.after)}</span>
                  <span
                    className={cn(
                      "ml-auto font-medium",
                      better && "text-success",
                      worse && "text-destructive",
                      !better && !worse && "text-muted-foreground",
                    )}
                  >
                    {change.delta > 0 ? "+" : change.delta < 0 ? "−" : "±"}
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
                    <span className="text-xs text-muted-foreground">
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
          <p className="flex items-start gap-2 text-xs text-[var(--warning)]">
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
      </CardContent>
    </Card>
  );
}

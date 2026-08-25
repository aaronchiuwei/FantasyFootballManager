"use client";

import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  BAND_META,
  type TradeAnalysis,
  type TradeSideKey,
} from "@/lib/trades/analyze";
import type { TradeBoardAsset } from "@/lib/trades/store";
import { cn } from "@/lib/utils";

import { BalanceBeam, type BeamTone } from "./balance-beam";
import { CountUp } from "./count-up";

const TEXT: Record<BeamTone, string> = {
  fair: "text-verdict-fair",
  tilted: "text-verdict-tilted",
  lopsided: "text-verdict-lopsided",
  idle: "text-muted-foreground",
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * The verdict, and §10's balance beam under it.
 *
 * Everything here is derived from one `analyzeTrade` call in the parent — no
 * fetch, no effect, no server round trip (§2). The crossfade is keyed on the
 * band rather than on every render, so the headline animates when the *answer*
 * changes and sits still while the user is only nudging numbers around.
 */
export function VerdictPanel({
  analysis,
  leagueId,
  names,
}: {
  analysis: TradeAnalysis<TradeBoardAsset>;
  leagueId: string;
  names: Record<TradeSideKey, string>;
}) {
  const { verdict, blocks } = analysis;
  const meta = verdict ? BAND_META[verdict.band] : null;
  const tone: BeamTone = meta ? meta.tone : "idle";

  const headline = verdict
    ? meta!.label
    : blocks.some((block) => block.kind === "unvalued")
      ? "No verdict"
      : "Build a trade";

  const detail = verdict
    ? verdict.winner === null
      ? meta!.summary
      : `${names[verdict.winner]} ahead by ${Math.round(
          Math.abs(verdict.delta),
        ).toLocaleString()} · ${percent(verdict.pct)}`
    : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          {(["a", "b"] as const).map((side) => (
            <div
              key={side}
              className={cn("min-w-0 space-y-0.5", side === "b" && "text-right")}
            >
              <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                {names[side]}
              </p>
              <CountUp
                value={analysis[side].total}
                className={cn(
                  "text-2xl font-semibold",
                  verdict?.winner === side && TEXT[tone],
                )}
              />
            </div>
          ))}
        </div>

        <BalanceBeam tilt={verdict?.tilt ?? 0} tone={tone} />

        {/* The crossfade §10 asks for: a new band is a new element. */}
        <div
          key={verdict ? verdict.band : headline}
          className="space-y-1 text-center animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
        >
          <p
            className={cn(
              "text-lg font-semibold tracking-tight",
              TEXT[tone],
            )}
          >
            {headline}
          </p>
          {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
        </div>

        {blocks.map((block) =>
          block.kind === "empty" ? (
            <p
              key="empty"
              className="text-center text-sm text-muted-foreground"
            >
              {block.side === "both"
                ? "Add a player to each side. A half-built trade is incomplete, not lopsided."
                : `Add at least one player from ${names[block.side]}.`}
            </p>
          ) : (
            <p
              key={`unvalued-${block.side}`}
              className="flex items-start justify-center gap-2 text-center text-sm text-[var(--warning)]"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {block.assets.map((asset) => asset.name).join(", ")} has no
                resolved value, so this trade gets no verdict.{" "}
                <Link
                  href={`/leagues/${leagueId}/identity`}
                  className="underline underline-offset-4"
                >
                  Resolve identity
                </Link>{" "}
                and sync — a missing value must never be summed as a zero.
              </span>
            </p>
          ),
        )}

        {verdict ? (
          <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {analysis.marketShare >= 0.999
                  ? "Every player here is priced by the market — this verdict is as firm as the numbers get."
                  : `${percent(analysis.marketShare)} of the value on the table is market-priced; the rest is modelled from projections.`}
              </span>
            </p>

            {verdict.withinNoise ? (
              <p className="flex items-start gap-2 text-[var(--warning)]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  The {percent(verdict.pct)} margin is inside the{" "}
                  {percent(verdict.noisePct)} the modelled values in this deal
                  could be wrong by. Read it as even.
                </span>
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

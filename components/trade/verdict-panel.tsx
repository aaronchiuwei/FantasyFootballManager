"use client";

import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";

import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import {
  BAND_META,
  type TradeAnalysis,
  type TradeAsset,
  type TradeSideKey,
} from "@/lib/trades/analyze";
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
 * The verdict, and the beam under it.
 *
 * Everything here is derived from one `analyzeTrade` call in the parent: no
 * fetch, no effect, no server round trip. The crossfade is keyed on the band
 * rather than on every render, so the headline animates when the ANSWER
 * changes and sits still while the user is only nudging numbers around.
 *
 * The surface resolves to one sentence. Every figure on it exists to support
 * that sentence, and the sentence is written on the board in grease pencil
 * rather than boxed, because it is the thing the manager leaves with.
 *
 * Generic over the asset, and `leagueId` is optional, because the open
 * analyzer renders this exact panel with no league behind it. Without one
 * there is no identity screen to send anybody to, so the unvalued warning
 * still says what is wrong and simply stops offering a fix that does not
 * exist.
 */
export function VerdictPanel<T extends TradeAsset & { name: string }>({
  analysis,
  leagueId,
  names,
}: {
  analysis: TradeAnalysis<T>;
  leagueId?: string | null;
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
        ).toLocaleString()} on ${percent(verdict.pct)}`
    : null;

  return (
    <Panel label="Verdict">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          {(["a", "b"] as const).map((side) => (
            <div
              key={side}
              className={cn(
                "flex min-w-0 flex-col gap-1",
                side === "b" && "items-end text-right",
              )}
            >
              <Stencil className="truncate">{names[side]}</Stencil>
              <CountUp
                value={analysis[side].total}
                className={cn(
                  "font-plate text-2xl font-bold tabular-nums",
                  verdict?.winner === side ? TEXT[tone] : "text-foreground",
                )}
              />
            </div>
          ))}
        </div>

        <BalanceBeam tilt={verdict?.tilt ?? 0} tone={tone} />

        {/* A new band is a new element, so the answer crossfades while the
            supporting figures stay put. */}
        <div
          key={verdict ? verdict.band : headline}
          className="flex flex-col items-center gap-1.5 text-center animate-in fade-in slide-in-from-bottom-1 duration-(--motion-base) motion-reduce:animate-none"
        >
          <p
            className={cn(
              "grease-underline pb-1 font-plate text-xl leading-tight font-bold tracking-[-0.01em]",
              TEXT[tone],
            )}
          >
            {headline}
          </p>
          {detail ? (
            <p className="max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
              {detail}
            </p>
          ) : null}
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
              className="flex items-start gap-2 text-sm leading-relaxed text-warning"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {block.assets.map((asset) => asset.name).join(", ")} has no
                resolved value, so this trade gets no verdict.{" "}
                {leagueId ? (
                  <>
                    <Link
                      href={`/leagues/${leagueId}/identity`}
                      className="underline underline-offset-4 decoration-grease decoration-2"
                    >
                      Resolve identity
                    </Link>{" "}
                    and sync.{" "}
                  </>
                ) : null}
                A missing value must never be summed as a zero.
              </span>
            </p>
          ),
        )}

        {verdict ? (
          <>
            <RailLine />
            <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {analysis.marketShare >= 0.999
                    ? "Every player here is priced by the market. This verdict is as firm as the numbers get."
                    : `${percent(
                        analysis.marketShare,
                      )} of the value on the table is market-priced. The rest is modelled from projections.`}
                </span>
              </p>

              {verdict.withinNoise ? (
                <p className="flex items-start gap-2 text-warning">
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span>
                    The {percent(verdict.pct)} margin is inside the{" "}
                    {percent(verdict.noisePct)} the modelled values in this deal
                    could be wrong by. Read it as even.
                  </span>
                </p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

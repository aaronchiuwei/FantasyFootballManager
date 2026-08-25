"use client";

import { Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BAND_META, type VerdictBand } from "@/lib/trades/analyze";
import type { TradeSnapshot } from "@/lib/trades/saved";
import { cn } from "@/lib/utils";

export type SavedTradeView = {
  id: string;
  note: string | null;
  createdAt: string;
  snapshot: TradeSnapshot;
};

const CHIP: Record<VerdictBand, string> = {
  even: "border-verdict-fair/40 bg-verdict-fair/10 text-verdict-fair",
  slight: "border-verdict-fair/40 bg-verdict-fair/10 text-verdict-fair",
  clear: "border-verdict-tilted/40 bg-verdict-tilted/10 text-verdict-tilted",
  lopsided:
    "border-verdict-lopsided/40 bg-verdict-lopsided/10 text-verdict-lopsided",
};

/**
 * One line of prose per saved row, so a list of them reads as a list of
 * judgements rather than a list of numbers. It lives here rather than beside
 * the snapshot shape because that module carries a Zod parser the browser has
 * no use for, and §10's bundle guardrail is not negotiable over a sentence.
 */
function describe(snapshot: TradeSnapshot): string {
  const band = BAND_META[snapshot.band as VerdictBand].label;
  const margin = `${Math.round(snapshot.pct * 1000) / 10}%`;

  if (!snapshot.winner) return `${band} — ${margin} apart`;

  const winner =
    snapshot[snapshot.winner].teamName ??
    (snapshot.winner === "a" ? "Side A" : "Side B");

  return `${band} — ${winner} by ${Math.round(
    Math.abs(snapshot.delta),
  ).toLocaleString()} (${margin})`;
}

function when(timestamp: string): string {
  const days = (Date.now() - Date.parse(timestamp)) / 86_400_000;
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  return `${Math.round(days)}d ago`;
}

function side(snapshot: TradeSnapshot, key: "a" | "b"): string {
  const assets = snapshot[key].assets;
  return assets.length === 0 ? "—" : assets.map((asset) => asset.name).join(", ");
}

/**
 * The trades a user kept.
 *
 * Each row shows the verdict *as it was*, not as it would be today — the
 * payload froze the values that produced it (§8). Loading one back into the
 * analyzer re-prices it against the current board, which is the comparison
 * worth having: the whole point of a saved trade is watching an offer age.
 */
export function SavedTrades({
  trades,
  onLoad,
  onDelete,
  pendingId,
}: {
  trades: SavedTradeView[];
  onLoad: (trade: SavedTradeView) => void;
  onDelete: (tradeId: string) => void;
  pendingId: string | null;
}) {
  if (trades.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
        Nothing saved yet. A saved trade keeps the values it was judged on, so
        you can see how an offer ages.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {trades.map((trade) => {
        const { snapshot } = trade;
        const band = snapshot.band as VerdictBand;

        return (
          <li
            key={trade.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3 py-2.5"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-4xl border px-2 text-[0.6875rem] font-medium",
                    CHIP[band],
                  )}
                >
                  {BAND_META[band].label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {when(trade.createdAt)}
                </span>
              </div>

              <p className="text-sm">
                <span className="text-muted-foreground">
                  {snapshot.a.teamName ?? "Side A"}:
                </span>{" "}
                {side(snapshot, "a")}
                <span className="mx-1.5 text-muted-foreground">↔</span>
                <span className="text-muted-foreground">
                  {snapshot.b.teamName ?? "Side B"}:
                </span>{" "}
                {side(snapshot, "b")}
              </p>

              <p className="text-xs text-muted-foreground">
                {describe(snapshot)}
                {trade.note ? ` · ${trade.note}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => onLoad(trade)}>
                <Upload className="size-3.5" aria-hidden />
                Load
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pendingId === trade.id}
                onClick={() => onDelete(trade.id)}
                aria-label="Delete saved trade"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

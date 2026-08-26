"use client";

import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import type { SeasonLines } from "@/lib/players/stat-lines";
import { cn } from "@/lib/utils";

/**
 * §10: "current vs. projected stats as animated bars."
 *
 * The bar is the comparison — two numbers on a shared scale say more about a
 * season than two numbers in a table do. The growth on mount is a client
 * concern and nothing else, which is why this is the only client component on
 * the page; `prefers-reduced-motion` flattens it to an instant paint through
 * the global rule in `app/globals.css`.
 */
function Bar({
  label,
  points,
  share,
  tone,
  empty,
}: {
  label: string;
  points: number | null;
  share: number;
  tone: string;
  empty: string;
}) {
  const [grown, setGrown] = useState(false);
  useEffect(() => setGrown(true), []);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "font-mono text-sm tabular-nums",
            points === null && "text-muted-foreground",
          )}
        >
          {points === null ? empty : points.toFixed(1)}
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-4xl bg-muted">
        <div
          className={cn("h-full rounded-4xl transition-[width] duration-[var(--motion-slow)] motion-reduce:transition-none", tone)}
          style={{ width: `${grown ? Math.round(share * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}

export function SeasonSummary({
  lines,
  label,
  hint,
}: {
  lines: SeasonLines;
  label: string;
  hint: string;
}) {
  const { actual, projected, gamesPlayed } = lines.total;

  // Both bars share one scale, or the comparison is a lie. An unplayed season
  // has only the projection, and it fills the track.
  const scale = Math.max(actual ?? 0, projected ?? 0, 1);
  const perGame =
    actual !== null && gamesPlayed ? actual / gamesPlayed : null;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>

        <div className="space-y-3">
          <Bar
            label="Projected"
            points={projected}
            share={(projected ?? 0) / scale}
            tone="bg-source-model"
            empty="not projected"
          />
          <Bar
            label="Actual"
            points={actual}
            share={(actual ?? 0) / scale}
            tone="bg-source-market"
            empty="no games played"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {gamesPlayed === null
            ? `${lines.weeks.length} week${lines.weeks.length === 1 ? "" : "s"} on the grid`
            : `${gamesPlayed} game${gamesPlayed === 1 ? "" : "s"}${
                perGame === null ? "" : ` · ${perGame.toFixed(1)} per game`
              }`}
        </p>
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { AlertTriangle, ArrowRight, Info } from "lucide-react";

import { PlayerHeadshot } from "@/components/players/headshot";
import { InjuryBadge } from "@/components/players/injury-badge";
import { Card, CardContent } from "@/components/ui/card";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { BAND_META } from "@/lib/trades/analyze";
import type {
  SuggestionPayload,
  SuggestionPayloadSide,
} from "@/lib/suggestions/payload";
import { cn } from "@/lib/utils";

function points(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "=";
  return `${sign}${points(Math.abs(value))}`;
}

/**
 * One side of a suggested trade: who is sending what, what it prices at, and —
 * §5's rule, which does not stop at the analyzer — where every one of those
 * prices came from.
 */
function Side({
  side,
  name,
  direction,
}: {
  side: SuggestionPayloadSide;
  name: string;
  direction: string;
}) {
  const better = side.lineup.delta > 0;

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_42%,transparent)] shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate stencil text-chalk-dim">
          {name}
        </p>
        <p className="shrink-0 text-[0.6875rem] text-muted-foreground">
          {direction}
        </p>
      </div>

      <ul className="space-y-1.5">
        {side.assets.map((asset) => (
          <li key={asset.playerId} className="flex items-center gap-2">
            <PlayerHeadshot
              src={asset.headshot}
              name={asset.name}
              size="sm"
            />
            <PositionBadge position={asset.position} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {asset.name}
            </span>
            <InjuryBadge status={asset.injuryStatus} />
            <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
              {asset.value.toLocaleString()}
            </span>
            <ValueBadge source={asset.source} />
          </li>
        ))}
      </ul>

      <p className="flex items-center gap-2 border-t pt-2 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{points(side.lineup.before)}</span>
        <ArrowRight className="size-3" aria-hidden />
        <span>{points(side.lineup.after)}</span>
        <span
          className={cn(
            "ml-auto font-medium",
            better ? "text-success" : "text-muted-foreground",
          )}
        >
          {signed(side.lineup.delta)}
        </span>
      </p>
    </div>
  );
}

/**
 * One suggested trade, whether it came out of §9's cached win-win search or
 * §10's builder — they are the same object and deserve the same card.
 *
 * The card answers the three questions a manager has about an offer they did
 * not assemble, in the order they ask them. *Who sends what*, because that is
 * the trade. *What does it do to both lineups*, because a fair trade nobody
 * gains from is not worth sending — §9's whole objective is the smaller of
 * those two numbers. And *how firm are these prices*, because §5 says a package
 * built on modelled values is a fuzzier package and the user finds that out
 * before they send the offer rather than after.
 *
 * The band is always `even` or `slight`. §9 filters to `pct < 8%` and the
 * column has a check constraint saying the same thing, so the badge is not
 * reporting a verdict so much as confirming one — which is why it is small and
 * sits at the top rather than dominating the card the way the balance beam
 * dominates the analyzer.
 */
export function SuggestionCard({
  suggestion,
  leagueId,
  names,
  className,
}: {
  suggestion: SuggestionPayload;
  leagueId: string;
  /** Current team names by id — a renamed team is still the same team. */
  names?: Record<string, string>;
  className?: string;
}) {
  const meta = BAND_META[suggestion.band];
  const nameFor = (side: SuggestionPayloadSide) =>
    names?.[side.teamId] ?? side.teamName ?? "Unknown team";

  const ids = (side: SuggestionPayloadSide) =>
    side.assets.map((asset) => asset.playerId).join(",");

  const analyzer =
    `/leagues/${leagueId}/trade` +
    `?ta=${suggestion.a.teamId}&tb=${suggestion.b.teamId}` +
    `&a=${ids(suggestion.a)}&b=${ids(suggestion.b)}`;

  const empty = suggestion.a.lineup.empty + suggestion.b.lineup.empty;

  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardContent className="space-y-3 px-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-medium text-verdict-fair">{meta.label}</p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {percent(suggestion.pct)} apart
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Side
            side={suggestion.a}
            name={nameFor(suggestion.a)}
            direction="sends"
          />
          <Side
            side={suggestion.b}
            name={nameFor(suggestion.b)}
            direction="sends"
          />
        </div>

        {/* §9's objective, said in words. The minimum is the point: a trade
            that helps one side enormously and the other barely is not a
            win-win, it is a sale. */}
        <p className="text-sm">
          Both starting lineups improve. The smaller gain is{" "}
          <span className="font-mono font-medium tabular-nums text-success">
            +{points(suggestion.minGain)}
          </span>{" "}
          projected points over the rest of the season.
        </p>

        <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {suggestion.marketShare >= 0.999
                ? "Every player here is priced by the market. This package is as firm as the numbers get."
                : `${percent(suggestion.marketShare)} of the value in this package is market-priced; the rest is modelled from projections.`}
            </span>
          </p>

          {suggestion.withinNoise ? (
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                The {percent(suggestion.pct)} margin is inside what the modelled
                values here could be wrong by. Read it as even.
              </span>
            </p>
          ) : null}

          {empty > 0 ? (
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {empty} starting slot{empty === 1 ? "" : "s"} would be left
                unfilled afterwards.
              </span>
            </p>
          ) : null}

          <p>
            <Link
              href={analyzer}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Open in the analyzer
            </Link>{" "}
            to price it against today&rsquo;s board, tune the knobs, or save it.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

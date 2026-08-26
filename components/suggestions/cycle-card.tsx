import Link from "next/link";
import { AlertTriangle, ArrowRight, Info, RotateCw } from "lucide-react";

import { PlayerHeadshot } from "@/components/players/headshot";
import { InjuryBadge } from "@/components/players/injury-badge";
import { Card, CardContent } from "@/components/ui/card";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { BAND_META } from "@/lib/trades/analyze";
import type { CyclePayload, CyclePayloadLeg } from "@/lib/suggestions/payload";
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
 * One participant in the ring: what they send, who to, and the two numbers that
 * decide whether *they* would say yes.
 *
 * Both numbers are this manager's own. §7 requires each team to land inside the
 * fairness band on its own in-vs-out, so the percentage on this panel is the
 * verdict over this ledger alone rather than a share of some cycle-wide total —
 * there is no cycle-wide total, on purpose. A three-way whose books balance
 * while one manager is being robbed is not a fair trade with a rounding error
 * in it, and this is the layout that makes that impossible to miss: three
 * verdicts, side by side, none of them averaged.
 */
function Leg({
  leg,
  receivedFrom,
  name,
}: {
  leg: CyclePayloadLeg;
  receivedFrom: CyclePayloadLeg;
  name: (teamId: string) => string;
}) {
  const better = leg.lineup.delta > 0;

  return (
    <div className="flex flex-col gap-2 p-3 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_42%,transparent)] shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate stencil">
          {name(leg.teamId)}
        </p>
        <p className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
          {percent(leg.pct)}
        </p>
      </div>

      <p className="flex items-center gap-1 truncate text-[0.6875rem] text-muted-foreground">
        <span>sends to</span>
        <ArrowRight className="size-3 shrink-0" aria-hidden />
        <span className="truncate font-medium">{name(leg.toTeamId)}</span>
      </p>

      <ul className="space-y-1.5">
        {leg.assets.map((asset) => (
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

      <p className="truncate text-[0.6875rem] text-muted-foreground">
        gets {receivedFrom.assets.map((asset) => asset.name).join(", ")} from{" "}
        {name(receivedFrom.teamId)}
      </p>

      <p className="flex items-center gap-2 border-t pt-2 font-mono text-xs tabular-nums text-muted-foreground">
        <span>{points(leg.lineup.before)}</span>
        <ArrowRight className="size-3" aria-hidden />
        <span>{points(leg.lineup.after)}</span>
        <span
          className={cn(
            "ml-auto font-medium",
            better ? "text-success" : "text-muted-foreground",
          )}
        >
          {signed(leg.lineup.delta)}
        </span>
      </p>
    </div>
  );
}

/**
 * One three-team trade (§7, Requirement 11).
 *
 * Deliberately *not* the two-team card with a third column bolted on. A cycle
 * has no sides — nobody trades with anybody here, which is the entire reason
 * the deal exists — so the card is three equal ledgers in ring order, and the
 * band at the top is the **worst** of the three rather than an average. §7's
 * rule is that every participant must independently land inside the fairness
 * band, and averaging three verdicts would be a way of not saying that.
 *
 * The band is always `even` or `slight`: the search filters to `pct < 8%` per
 * leg and the column carries a check constraint saying the same, so the badge
 * confirms a verdict rather than delivering one.
 */
export function CycleCard({
  cycle,
  leagueId,
  names,
  className,
}: {
  cycle: CyclePayload;
  leagueId: string;
  /** Current team names by id — a renamed team is still the same team. */
  names?: Record<string, string>;
  className?: string;
}) {
  const meta = BAND_META[cycle.band];
  const byId = new Map(cycle.legs.map((leg) => [leg.teamId, leg]));

  const name = (teamId: string) =>
    names?.[teamId] ?? byId.get(teamId)?.teamName ?? "Unknown team";

  const empty = cycle.legs.reduce((sum, leg) => sum + leg.lineup.empty, 0);
  const ids = (leg: CyclePayloadLeg) =>
    leg.assets.map((asset) => asset.playerId).join(",");

  /**
   * Each leg's own ledger, openable in the analyzer. The players do not change
   * hands that way — that is the whole point of a cycle — but the arithmetic
   * the analyzer runs on `sent` against `received` is exactly the arithmetic
   * this card is reporting, which is what makes the number checkable rather
   * than merely asserted.
   */
  const ledger = (leg: CyclePayloadLeg, from: CyclePayloadLeg) =>
    `/leagues/${leagueId}/trade?ta=${leg.teamId}&tb=${from.teamId}` +
    `&a=${ids(leg)}&b=${ids(from)}`;

  return (
    <Card className={cn("gap-0 py-4", className)}>
      <CardContent className="space-y-3 px-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-verdict-fair">
            <RotateCw className="size-3.5" aria-hidden />
            Three-team · {meta.label}
          </p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            {percent(cycle.maxPct)} apart at its widest leg
          </p>
        </div>

        {/* Three at `lg`, not at `sm`. A leg is a whole ledger — a player list
            with a position badge, a name, a price and a provenance badge on
            each row — and three of them across a 592px container is 185px a
            column, where every name truncates to nothing. Stacked is the
            honest small-screen answer: the ring order is still the reading
            order, which is what the layout was carrying. */}
        <div className="grid gap-3 lg:grid-cols-3">
          {cycle.legs.map((leg, index) => (
            <Leg
              key={leg.teamId}
              leg={leg}
              // The ring: everybody receives from the leg behind them.
              receivedFrom={cycle.legs[(index + 2) % 3]}
              name={name}
            />
          ))}
        </div>

        <p className="text-sm">
          All three starting lineups improve. The smallest gain is{" "}
          <span className="font-mono font-medium tabular-nums text-success">
            +{points(cycle.minGain)}
          </span>{" "}
          projected points over the rest of the season.
        </p>

        <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {cycle.marketShare >= 0.999
                ? "Every player here is priced by the market. This cycle is as firm as the numbers get."
                : `${percent(cycle.marketShare)} of the value moving is market-priced; the rest is modelled from projections.`}
            </span>
          </p>

          {cycle.withinNoise ? (
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                The widest leg&rsquo;s {percent(cycle.maxPct)} margin is inside
                what the modelled values in it could be wrong by. Read that leg
                as even.
              </span>
            </p>
          ) : null}

          {empty > 0 ? (
            <p className="flex items-start gap-2 text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {empty} starting slot{empty === 1 ? "" : "s"} across the three
                rosters would be left unfilled afterwards.
              </span>
            </p>
          ) : null}

          <p>
            Check a manager&rsquo;s own ledger against today&rsquo;s board:{" "}
            {cycle.legs.map((leg, index) => (
              <span key={leg.teamId}>
                {index > 0 ? " · " : ""}
                <Link
                  href={ledger(leg, cycle.legs[(index + 2) % 3])}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {name(leg.teamId)}
                </Link>
              </span>
            ))}
            . The analyzer prices what each of them gives up against what they
            get; it cannot show all three at once, because the players do not
            move between two rosters.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

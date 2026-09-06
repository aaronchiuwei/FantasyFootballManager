"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import { EmptySeat } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import {
  shopPackage,
  SHOP_LIMITS,
  type Suggestion,
} from "@/lib/suggestions/search";
import { BAND_META, type TradeParams } from "@/lib/trades/analyze";
import type { TradeBoard, TradeBoardAsset } from "@/lib/trades/store";
import { cn } from "@/lib/utils";

/**
 * The board's assets in the currency both scorers want.
 *
 * `SuggestionAsset` is `TradeAsset & LineupPlayer & { teamId }`, and a board
 * asset is already all three except for the name of one field: the lineup math
 * reads `points` and the board carries the same number as `rosPoints`. The
 * conversion happens once for the whole board rather than once per candidate,
 * which is the same reason the server-side engines take it pre-converted.
 */
type ShopAsset = TradeBoardAsset & { points: number | null };

function toShopAsset(asset: TradeBoardAsset): ShopAsset {
  return { ...asset, points: asset.rosPoints };
}

function points(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function signed(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "=";
  return `${sign}${points(Math.abs(value))}`;
}

const TONE: Record<"fair" | "tilted" | "lopsided", string> = {
  fair: "bg-success/14 text-success",
  tilted: "bg-warning/14 text-warning",
  lopsided: "bg-destructive/14 text-destructive",
};

/** One roster's answer: what comes back, and what it does to both lineups. */
function Return({
  suggestion,
  teamName,
  fromLabel,
  onLoad,
}: {
  suggestion: Suggestion<ShopAsset>;
  teamName: string;
  /** Who is sending. "You" only when side A really is the user's team. */
  fromLabel: string;
  onLoad: () => void;
}) {
  const band = suggestion.analysis.verdict?.band ?? "even";
  const meta = BAND_META[band];

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xs p-3",
        "bg-[color-mix(in_oklch,var(--board-deep)_42%,transparent)]",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Stencil className="min-w-0 truncate" tone="chalk">
          {teamName}
        </Stencil>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "stencil inline-flex h-5 items-center gap-1 rounded-xs px-1.5 text-[0.5625rem]",
              TONE[meta.tone],
            )}
            title={meta.summary}
          >
            {meta.label}
            <span data-numeric className="tabular-nums">
              {((suggestion.analysis.verdict?.pct ?? 0) * 100).toFixed(1)}%
            </span>
          </span>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {suggestion.b.map((asset) => (
          <li key={asset.playerId} className="flex items-center gap-2">
            <PositionBadge position={asset.position} />
            <span className="min-w-0 flex-1 truncate font-plate text-sm font-semibold text-foreground">
              {asset.name}
            </span>
            <InjuryBadge status={asset.injuryStatus} note={asset.injuryNote} />
            <span
              data-numeric
              className="shrink-0 font-plate text-sm tabular-nums text-muted-foreground"
            >
              {asset.value.toLocaleString()}
            </span>
            <ValueBadge source={asset.source} />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Both deltas, always. A return that only helps the other manager is
            not a deal worth opening, and §9's whole test is that both move. */}
        <div className="flex items-center gap-3">
          <Stencil
            data-numeric
            tone="grease"
            className="tabular-nums"
            title={`What this does to ${fromLabel === "You" ? "your own" : `${fromLabel}'s`} starting lineup, in rest-of-season projected points.`}
          >
            {fromLabel} {signed(suggestion.lineupA.delta)}
          </Stencil>
          <Stencil
            data-numeric
            className="tabular-nums"
            title="What it does to theirs. Both have to improve or it is not on this list."
          >
            Them {signed(suggestion.lineupB.delta)}
          </Stencil>
        </div>

        <Button size="sm" variant="ghost" onClick={onLoad} className="shrink-0">
          Load
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/**
 * The question a manager asks looking at their own bench, which until now the
 * app had no way to answer.
 *
 * §9's win-win search reads the whole league and tells you which trades exist;
 * §10's builder fixes the player you *want* and prices what it would take. This
 * fixes the players you are willing to *move* and asks the other eleven rosters
 * what they would give — the mirror of the builder, and the only one of the
 * three shapes that starts from a decision the user has already made.
 *
 * It runs in the browser, on every pick, for the reason the verdict does: the
 * page already handed over the league's whole rostered board, and this is a
 * pure function over it. Eleven rosters at 92 packages each is a fraction of
 * the win-win search's 85,536 candidates, and the value-window prune throws
 * most of it away before the analyzer is ever called.
 */
export function ShopPanel({
  board,
  offer,
  fromTeamId,
  params,
  onLoad,
}: {
  board: TradeBoard;
  /** The package on the user's side of the analyzer, as it stands. */
  offer: TradeBoardAsset[];
  fromTeamId: string;
  params: TradeParams;
  /** Puts a return on the other side of the analyzer, ready to be argued with. */
  onLoad: (teamId: string, playerIds: number[]) => void;
}) {
  const names = useMemo(
    () => new Map(board.teams.map((team) => [team.id, team.name])),
    [board.teams],
  );

  // The analyzer's left column is not always the user's own team — either side
  // can be pointed at any roster — so the sending side is named rather than
  // assumed. "You +12.4" against somebody else's lineup is a lie in the one
  // place a manager is least likely to check it.
  const fromLabel = useMemo(() => {
    const from = board.teams.find((team) => team.id === fromTeamId);
    if (!from) return "Them";
    return from.isUsersTeam ? "You" : from.name;
  }, [board.teams, fromTeamId]);

  const result = useMemo(() => {
    const from = board.teams.find((team) => team.id === fromTeamId);
    if (!from) return null;

    const assets = board.assets.map(toShopAsset);
    const rosterOf = (teamId: string) =>
      assets.filter((asset) => asset.teamId === teamId);

    return shopPackage(
      {
        offer: offer.map(toShopAsset),
        from: {
          teamId: from.id,
          roster: rosterOf(from.id),
          surplusZ: from.surplusZ,
          need: from.needs,
        },
        others: board.teams
          .filter((team) => team.id !== fromTeamId)
          .map((team) => ({
            teamId: team.id,
            roster: rosterOf(team.id),
            surplusZ: team.surplusZ,
            need: team.needs,
          })),
      },
      board.rosterSlots,
      params,
    );
  }, [board.assets, board.teams, board.rosterSlots, offer, fromTeamId, params]);

  if (!result) return null;

  const { suggestions, stats } = result;

  const note =
    stats.blocked === "unvalued"
      ? "One of these players has no resolved value, so no package can be priced against them. The analyzer refuses this trade a verdict for the same reason."
      : `Every other roster in the league, searched for a fair return that leaves both starting lineups better than it found them. ${stats.evaluated.toLocaleString()} packages priced across ${stats.teams} team${stats.teams === 1 ? "" : "s"}, ${stats.fair.toLocaleString()} fair by value, ${stats.winWin.toLocaleString()} of those good for both.`;

  return (
    <Panel
      label={`Who wants this · ${suggestions.length} return${suggestions.length === 1 ? "" : "s"}`}
      note={note}
      action={
        <div className="text-right">
          <p
            data-numeric
            className="font-plate text-xl font-bold tabular-nums text-foreground"
          >
            {Math.round(stats.askingPrice).toLocaleString()}
          </p>
          <Stencil className="block">on the table</Stencil>
        </div>
      }
    >
      {suggestions.length === 0 ? (
        <EmptySeat className="min-h-14 px-4 text-center">
          {stats.blocked === "unvalued"
            ? "Nothing to search"
            : stats.fair === 0
              ? "Nobody can match this package inside the fair band"
              : "Fair returns exist, but none of them improves both lineups"}
        </EmptySeat>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {suggestions.map((suggestion) => (
            <Return
              key={`${suggestion.teamB}-${suggestion.b.map((a) => a.playerId).join("-")}`}
              suggestion={suggestion}
              teamName={names.get(suggestion.teamB) ?? "Unknown team"}
              fromLabel={fromLabel}
              onLoad={() =>
                onLoad(
                  suggestion.teamB,
                  suggestion.b.map((asset) => asset.playerId),
                )
              }
            />
          ))}
        </div>
      )}

      {suggestions.length >= SHOP_LIMITS.results ? (
        <p className="pt-3 text-xs text-muted-foreground">
          Showing the best {SHOP_LIMITS.results}, at most {SHOP_LIMITS.perTeam}{" "}
          from any one roster.
        </p>
      ) : null}
    </Panel>
  );
}

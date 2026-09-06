"use client";

import { useMemo } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import { EmptySeat, RailLine } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import {
  shopPackage,
  SHOP_LIMITS,
  type ShopFit,
  type ShopReturn,
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

/**
 * What a fair price does to the two lineups, said in words as well as in the
 * two figures beside it. Fairness is a claim about value and carries no claim
 * at all about whether either team gets better; the card has to make that its
 * own line or the list reads as twelve equally good ideas.
 */
const FIT_WORDS: Record<ShopFit, { label: string; title: string }> = {
  "win-win": {
    label: "Both gain",
    title:
      "Both starting lineups improve. This is the deal the other manager has a reason to accept.",
  },
  yours: {
    label: "Yours gains",
    title:
      "A fair price, but only your lineup improves. Worth asking; they have no lineup reason to say yes.",
  },
  theirs: {
    label: "Theirs gains",
    title:
      "A fair price that improves their lineup and not yours. They would send this; you would be paying for the privilege.",
  },
  neither: {
    label: "Even swap",
    title:
      "A fair price that moves neither Sunday. Common when two rosters are shaped the same way.",
  },
};

/** One roster's answer: what comes back, and what it does to both lineups. */
function Return({
  suggestion,
  teamName,
  fromLabel,
  onLoad,
}: {
  suggestion: ShopReturn<ShopAsset>;
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

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "stencil inline-flex h-5 items-center rounded-xs px-1.5 text-[0.5625rem]",
              "bg-[color-mix(in_oklch,var(--channel)_55%,transparent)] text-chalk-dim",
            )}
            title={FIT_WORDS[suggestion.fit].title}
          >
            {FIT_WORDS[suggestion.fit].label}
          </span>

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
            title="What it does to their starting lineup. A return only they gain from is one you are paying for."
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

  const { winWin, fair, stats } = result;
  const shown = winWin.length + fair.length;

  const note =
    stats.blocked === "unvalued"
      ? "One of these players has no resolved value, so no package can be priced against them. The analyzer refuses this trade a verdict for the same reason."
      : `Every other roster in the league, searched for a package that prices out fair against this one. ${stats.evaluated.toLocaleString()} priced across ${stats.teams} team${stats.teams === 1 ? "" : "s"}, ${stats.fair.toLocaleString()} fair by value, ${stats.winWin.toLocaleString()} of those good for both lineups.`;

  const list = (returns: typeof winWin) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {returns.map((suggestion) => (
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
  );

  return (
    <Panel
      label={`Who wants this · ${shown} return${shown === 1 ? "" : "s"}`}
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
      {shown === 0 ? (
        <EmptySeat className="min-h-14 px-4 text-center">
          {stats.blocked === "unvalued"
            ? "Nothing to search"
            : "Nobody can match this package inside the fair band"}
        </EmptySeat>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Two lists rather than one, because the ordering of a mixed list
              would have to mean two things at once. The first answers "which
              of these would they send back"; the second answers the question
              actually asked, which is what these players are worth. */}
          {winWin.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <Stencil tone="grease">
                  Both lineups gain · {winWin.length}
                </Stencil>
                <p className="text-xs text-muted-foreground">
                  Fair by value, and both starting lineups improve.
                </p>
              </div>
              <RailLine />
              {list(winWin)}
            </div>
          ) : null}

          {fair.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <Stencil>Fair value · {fair.length}</Stencil>
                <p className="max-w-[46ch] text-right text-xs text-muted-foreground">
                  {winWin.length === 0
                    ? "Nothing improves both lineups. These are priced fair and labelled with who actually gains."
                    : "A fair price where the lineup gain runs one way. Yours first, then by how close each came to helping both."}
                </p>
              </div>
              <RailLine />
              {list(fair)}
            </div>
          ) : null}
        </div>
      )}

      {winWin.length >= SHOP_LIMITS.winWinResults ||
      fair.length >= SHOP_LIMITS.fairResults ? (
        <p className="pt-3 text-xs text-muted-foreground">
          Showing the best {SHOP_LIMITS.winWinResults} of each, at most{" "}
          {SHOP_LIMITS.perTeam} per list from any one roster.
        </p>
      ) : null}
    </Panel>
  );
}

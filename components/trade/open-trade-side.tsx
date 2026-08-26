"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";

import { InjuryBadge } from "@/components/players/injury-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { Panel, Stencil } from "@/components/board/panel";
import { PlateCore } from "@/components/board/plate";
import { RailLine } from "@/components/board/rail";
import type { SideTotals, TradeSideKey } from "@/lib/trades/analyze";
import type { OpenAsset } from "@/lib/trades/open-board";
import { MAX_SIDE, MIN_SEARCH_LENGTH, searchAssets } from "@/lib/trades/open-market";
import { cn } from "@/lib/utils";

import { CountUp } from "./count-up";

/** Long enough to write "Marcus (league winner)", short enough to fit a head. */
export const MAX_SIDE_NAME = 24;

function Signed({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span data-numeric className="font-plate tabular-nums">
      {rounded > 0 ? "+" : rounded < 0 ? "-" : ""}
      {Math.abs(rounded).toLocaleString()}
    </span>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="stencil text-chalk-dim">{label}</dt>
      <dd className="text-right font-plate text-xs text-foreground">
        {children}
      </dd>
    </>
  );
}

/**
 * One side of a trade that has no roster behind it.
 *
 * The league analyzer's side (`trade-side.tsx`) opens with a team select and a
 * rail of that team's plates, because ownership is a fact it holds: a player
 * can only be sent by whoever rosters them. Here nobody owns anybody, so the
 * whole board is the pool and the only way in is by name — which makes the
 * search box the thing this component is built around rather than an
 * afterthought bolted above a list.
 *
 * The rest is deliberately identical to the league side: the same plates, the
 * same channel, the same arithmetic printed underneath. Somebody who starts
 * here and imports a league later should recognize the screen they arrive at,
 * and the breakdown is the reason either version is arguable with a leaguemate
 * at all.
 */
export function OpenTradeSide({
  sideKey,
  name,
  label,
  onNameChange,
  board,
  totals,
  taken,
  onAdd,
  onRemove,
}: {
  sideKey: TradeSideKey;
  /** What the user typed, which is allowed to be nothing. */
  name: string;
  /** What to call this side when they have not: "You" and "Them". */
  label: string;
  onNameChange: (name: string) => void;
  board: OpenAsset[];
  totals: SideTotals<OpenAsset>;
  /** Everyone already in the trade, either side: nobody is traded twice. */
  taken: Set<number>;
  onAdd: (playerId: number) => void;
  onRemove: (playerId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => searchAssets(board, query, { exclude: taken }),
    [board, query, taken],
  );

  const full = totals.count >= MAX_SIDE;
  const searching = query.trim().length >= MIN_SEARCH_LENGTH;

  function add(playerId: number) {
    onAdd(playerId);
    setQuery("");
    // The next player is almost always the next thing typed. Handing focus
    // back means a three-player package is one continuous action.
    input.current?.focus();
  }

  return (
    <Panel label={`${label} sends`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <Stencil>Side {sideKey.toUpperCase()}</Stencil>
            <input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={MAX_SIDE_NAME}
              placeholder={label}
              aria-label={`Name for side ${sideKey.toUpperCase()}`}
              className={cn(
                "h-8 w-full max-w-[15rem] min-w-0 rounded-xs px-2 font-plate text-sm text-foreground",
                "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)]",
                "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]",
                "outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              )}
            />
          </label>

          <div className="shrink-0 text-right">
            <CountUp
              value={totals.total}
              className="font-plate text-2xl font-bold tabular-nums text-foreground"
            />
            <p className="stencil mt-0.5 text-chalk-dim">
              {totals.count === 0
                ? "nothing yet"
                : `${totals.count} plate${totals.count === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {/* The search. On the league side this space is a roster; here it is
            the way a roster gets built, so it sits above the channel rather
            than below it. */}
        <div className="flex flex-col gap-1.5">
          <div
            className={cn(
              "flex h-9 items-center gap-2 rounded-xs px-2.5",
              "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)]",
              "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]",
              "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
            )}
          >
            <Search className="size-4 shrink-0 text-chalk-dim" aria-hidden />
            <input
              ref={input}
              type="search"
              value={query}
              disabled={full}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Type a name, press Enter, keep typing. The list is ranked,
                // so the top hit is the one being named.
                if (event.key === "Enter" && results.length > 0) {
                  event.preventDefault();
                  add(results[0].playerId);
                }
                if (event.key === "Escape") setQuery("");
              }}
              placeholder={
                full ? `${MAX_SIDE} players is the limit` : "Search a player by name"
              }
              aria-label={`Add a player to side ${sideKey.toUpperCase()}`}
              className="min-w-0 flex-1 bg-transparent font-plate text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
          </div>

          {searching && !full ? (
            results.length === 0 ? (
              /* The board is the market's, and the market does not price
                 everybody. Saying which board came up empty is the difference
                 between a limit and a bug. */
              <p className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">
                No player on this market board matches “{query.trim()}”.
                FantasyCalc prices the top ~192 QB, RB, WR and TE only.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {results.map((asset) => (
                  <li key={asset.playerId}>
                    <button
                      type="button"
                      onClick={() => add(asset.playerId)}
                      className={cn(
                        "plate plate-liftable flex h-10 w-full items-stretch overflow-hidden text-left",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      )}
                    >
                      <PlateCore position={asset.position} />
                      <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="engraved font-plate text-sm font-semibold text-plate-ink">
                            {asset.name}
                          </span>
                          <span className="stencil ml-1.5 text-plate-ink/75">
                            {asset.nflTeam ?? "FA"}
                            {asset.positionRank
                              ? ` · ${asset.position}${asset.positionRank}`
                              : ""}
                          </span>
                        </span>
                        <InjuryBadge status={asset.injuryStatus} />
                        <span
                          data-numeric
                          className="engraved shrink-0 font-plate text-sm font-bold tabular-nums text-plate-ink"
                        >
                          {asset.value.toLocaleString()}
                        </span>
                        <Plus
                          className="size-3.5 shrink-0 text-plate-ink/45"
                          aria-hidden
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>

        <div
          className={cn(
            "min-h-24 rounded-xs p-2",
            "bg-[color-mix(in_oklch,var(--board-deep)_50%,transparent)]",
            "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]",
          )}
        >
          {totals.assets.length === 0 ? (
            <p className="grid h-20 place-items-center px-4 text-center text-xs text-muted-foreground">
              Search a name above to put a player on this side of the table.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {totals.assets.map((asset) => (
                <li
                  key={asset.playerId}
                  className="plate flex h-10 items-stretch overflow-hidden"
                >
                  <PlateCore position={asset.position} />
                  <span className="flex min-w-0 flex-1 items-center gap-2 px-2.5">
                    <span className="engraved min-w-0 flex-1 truncate font-plate text-sm font-semibold text-plate-ink">
                      {asset.name}
                    </span>
                    <InjuryBadge status={asset.injuryStatus} />
                    <span
                      data-numeric
                      className="engraved shrink-0 font-plate text-sm font-bold tabular-nums text-plate-ink"
                    >
                      {asset.value.toLocaleString()}
                    </span>
                    <ValueBadge source={asset.source} />
                    <button
                      type="button"
                      onClick={() => onRemove(asset.playerId)}
                      aria-label={`Remove ${asset.name}`}
                      className="shrink-0 rounded-xs text-plate-ink/50 transition-colors duration-(--motion-fast) hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {totals.count > 0 ? (
          <>
            <RailLine />
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
              <Term label="Raw value">
                <span data-numeric className="tabular-nums">
                  {Math.round(totals.base).toLocaleString()}
                </span>
              </Term>

              <Term label="Best player bonus (α)">
                <Signed value={totals.bonus} />
              </Term>

              {totals.headlineBonus > 0 ? (
                <Term label="Top asset in the deal (γ)">
                  <Signed value={totals.headlineBonus} />
                </Term>
              ) : null}

              {totals.depthPenalty > 0 ? (
                <Term label="Roster spots (β)">
                  <Signed value={-totals.depthPenalty} />
                </Term>
              ) : null}
            </dl>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

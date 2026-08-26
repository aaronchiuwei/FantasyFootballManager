"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { InjuryBadge } from "@/components/players/injury-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { Panel, Stencil } from "@/components/board/panel";
import { PlateCore } from "@/components/board/plate";
import { RailLine } from "@/components/board/rail";
import type { SideTotals, TradeSideKey } from "@/lib/trades/analyze";
import type { TradeBoardAsset, TradeBoardTeam } from "@/lib/trades/store";
import { cn } from "@/lib/utils";

import { CountUp } from "./count-up";

/** The drag payload: one player id, as text, which is all any of this needs. */
export const DRAG_TYPE = "text/plain";

function Signed({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span data-numeric className="font-plate tabular-nums">
      {rounded > 0 ? "+" : rounded < 0 ? "-" : ""}
      {Math.abs(rounded).toLocaleString()}
    </span>
  );
}

/** A row of the breakdown: a stencilled term against its tabular figure. */
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
 * One package: who it comes from, what is in it, and how the arithmetic got
 * from a pile of players to a number.
 *
 * This is where the world's central rule earns its keep. A roster is a rail of
 * engraved plates; picking one up lifts it; putting it on the table seats it
 * in the deal's own channel. Nothing else on the screen is bone, so "what is
 * in this trade" is answerable without reading a word.
 *
 * The breakdown is not a debugging aid. A verdict the user cannot take apart
 * is a verdict they cannot argue with a leaguemate, which is the same reason
 * the underlying values stay quotable.
 */
export function TradeSide({
  sideKey,
  label,
  teams,
  teamId,
  onTeamChange,
  roster,
  totals,
  onAdd,
  onRemove,
}: {
  sideKey: TradeSideKey;
  label: string;
  teams: TradeBoardTeam[];
  teamId: string | null;
  onTeamChange: (teamId: string) => void;
  roster: TradeBoardAsset[];
  totals: SideTotals<TradeBoardAsset>;
  onAdd: (playerId: number) => void;
  onRemove: (playerId: number) => void;
}) {
  const [over, setOver] = useState(false);
  const picked = new Set(totals.assets.map((asset) => asset.playerId));

  return (
    <Panel label={`${label} sends`}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-3">
          <select
            aria-label={`Team on side ${sideKey.toUpperCase()}`}
            value={teamId ?? ""}
            onChange={(event) => onTeamChange(event.target.value)}
            className={cn(
              "h-8 w-full max-w-[15rem] min-w-0 rounded-xs px-2 font-plate text-sm text-foreground",
              "bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)]",
              "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]",
              "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
                {team.isUsersTeam ? " (you)" : ""}
              </option>
            ))}
          </select>

          <div className="shrink-0 text-right">
            <CountUp
              value={totals.total}
              className="font-plate text-2xl font-bold tabular-nums text-foreground"
            />
            <p className="stencil mt-0.5 text-chalk-dim">
              {/* "Plate" is what the design language calls the object; it is
                  not what a manager calls a running back. The metaphor stays
                  in the styling and out of the sentence. */}
              {totals.count === 0
                ? "nothing yet"
                : `${totals.count} player${totals.count === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {/* The deal's own channel. Dragging is the pleasant path; clicking is
            the one that works with a keyboard, a screen reader and a phone. */}
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const id = Number(event.dataTransfer.getData(DRAG_TYPE));
            if (Number.isFinite(id) && id > 0) onAdd(id);
          }}
          className={cn(
            "min-h-24 rounded-xs p-2 transition-[background-color,box-shadow] duration-(--motion-fast) ease-(--ease-out) motion-reduce:transition-none",
            "bg-[color-mix(in_oklch,var(--board-deep)_50%,transparent)]",
            over
              ? "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent),inset_0_0_0_1px_var(--grease)]"
              : "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]",
          )}
        >
          {totals.assets.length === 0 ? (
            /* Leads with the interaction that works everywhere. Dragging is
               the pleasant path on a desktop and is not available at all on a
               touch screen, so an empty channel that opens by asking for a
               drag is instructions a phone cannot follow. */
            <p className="grid h-20 place-items-center px-4 text-center text-xs text-muted-foreground">
              Pick players from the roster below, or drag them in here.
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

        <RailLine />

        <div className="flex flex-col gap-1.5">
          <Stencil>Roster</Stencil>
          <div className="max-h-72 overflow-y-auto pr-1">
            {roster.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                This team has no valued players yet. Run a sync.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {roster.map((asset) => {
                  const taken = picked.has(asset.playerId);

                  return (
                    <li key={asset.playerId}>
                      <button
                        type="button"
                        draggable={!taken}
                        onDragStart={(event) =>
                          event.dataTransfer.setData(
                            DRAG_TYPE,
                            String(asset.playerId),
                          )
                        }
                        onClick={() => onAdd(asset.playerId)}
                        disabled={taken}
                        className={cn(
                          "plate flex h-10 w-full items-stretch overflow-hidden text-left",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          taken
                            ? "cursor-default opacity-35"
                            : "plate-liftable active:cursor-grabbing",
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
                              {asset.slot ? ` · ${asset.slot}` : ""}
                            </span>
                          </span>
                          <InjuryBadge status={asset.injuryStatus} />
                          <span
                            data-numeric
                            className="engraved shrink-0 font-plate text-sm font-bold tabular-nums text-plate-ink"
                          >
                            {asset.value.toLocaleString()}
                          </span>
                          <ValueBadge source={asset.source} />
                          {taken ? null : (
                            <Plus
                              className="size-3.5 shrink-0 text-plate-ink/45"
                              aria-hidden
                            />
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

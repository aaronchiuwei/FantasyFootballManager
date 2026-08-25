"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { Card, CardContent } from "@/components/ui/card";
import type { SideTotals, TradeSideKey } from "@/lib/trades/analyze";
import type { TradeBoardAsset, TradeBoardTeam } from "@/lib/trades/store";
import { cn } from "@/lib/utils";

import { CountUp } from "./count-up";

/** The drag payload: one player id, as text, which is all any of this needs. */
export const DRAG_TYPE = "text/plain";

function Money({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="font-mono tabular-nums">
      {rounded > 0 ? "+" : rounded < 0 ? "−" : ""}
      {Math.abs(rounded).toLocaleString()}
    </span>
  );
}

/**
 * One package: who it comes from, what is in it, and how §6's arithmetic got
 * from a pile of players to a number.
 *
 * The breakdown is not a debugging aid. A verdict the user cannot take apart is
 * a verdict they cannot argue with a leaguemate, which is the same reason §3
 * insists the underlying values stay quotable.
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
    <Card className="gap-0 py-4">
      <CardContent className="space-y-3 px-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {label} sends
            </p>
            <select
              aria-label={`Team on side ${sideKey.toUpperCase()}`}
              value={teamId ?? ""}
              onChange={(event) => onTeamChange(event.target.value)}
              className="h-8 w-full max-w-[15rem] rounded-md border bg-background px-2 text-sm"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                  {team.isUsersTeam ? " (you)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="text-right">
            <CountUp value={totals.total} className="text-2xl font-semibold" />
            <p className="text-xs text-muted-foreground">
              {totals.count === 0
                ? "nothing yet"
                : `${totals.count} player${totals.count === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {/* §10's drop zone. Dragging is the pleasant path; clicking is the one
            that works with a keyboard, a screen reader and a phone. */}
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
            "min-h-24 rounded-lg border border-dashed p-2 transition-colors motion-reduce:transition-none",
            over ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          {totals.assets.length === 0 ? (
            <p className="grid h-20 place-items-center px-4 text-center text-xs text-muted-foreground">
              Drag players here, or pick them from the roster below.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {totals.assets.map((asset) => (
                <li
                  key={asset.playerId}
                  className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5"
                >
                  <PositionBadge position={asset.position} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {asset.name}
                  </span>
                  <InjuryBadge status={asset.injuryStatus} />
                  <span className="font-mono text-sm tabular-nums">
                    {asset.value.toLocaleString()}
                  </span>
                  <ValueBadge source={asset.source} />
                  <button
                    type="button"
                    onClick={() => onRemove(asset.playerId)}
                    aria-label={`Remove ${asset.name}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {totals.count > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <dt>Raw value</dt>
            <dd className="text-right font-mono tabular-nums">
              {Math.round(totals.base).toLocaleString()}
            </dd>

            <dt>Best player bonus (α)</dt>
            <dd className="text-right">
              <Money value={totals.bonus} />
            </dd>

            {totals.headlineBonus > 0 ? (
              <>
                <dt>Top asset in the deal (γ)</dt>
                <dd className="text-right">
                  <Money value={totals.headlineBonus} />
                </dd>
              </>
            ) : null}

            {totals.depthPenalty > 0 ? (
              <>
                <dt>Roster spots (β)</dt>
                <dd className="text-right">
                  <Money value={-totals.depthPenalty} />
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}

        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {roster.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              This team has no valued players yet. Run a sync.
            </p>
          ) : (
            roster.map((asset) => {
              const taken = picked.has(asset.playerId);

              return (
                <button
                  key={asset.playerId}
                  type="button"
                  draggable={!taken}
                  onDragStart={(event) =>
                    event.dataTransfer.setData(DRAG_TYPE, String(asset.playerId))
                  }
                  onClick={() => onAdd(asset.playerId)}
                  disabled={taken}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors motion-reduce:transition-none",
                    taken
                      ? "cursor-default opacity-40"
                      : "hover:bg-muted active:cursor-grabbing",
                  )}
                >
                  <PositionBadge position={asset.position} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {asset.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {asset.nflTeam ?? "FA"}
                      {asset.slot ? ` · ${asset.slot}` : ""}
                    </span>
                  </span>
                  <InjuryBadge status={asset.injuryStatus} />
                  <span className="font-mono text-sm tabular-nums">
                    {asset.value.toLocaleString()}
                  </span>
                  <ValueBadge source={asset.source} />
                  {taken ? null : (
                    <Plus className="size-3.5 text-muted-foreground" aria-hidden />
                  )}
                </button>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

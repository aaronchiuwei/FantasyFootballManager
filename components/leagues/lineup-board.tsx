"use client";

import { useState, useTransition } from "react";
import { WandSparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { GreaseNote, Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { slotFits } from "@/lib/needs/lineup";
import { cn } from "@/lib/utils";

/**
 * The lineup, as a lineup.
 *
 * The roster editor on the manage screen asks the question the other way round
 * — for each of fifteen players, which slot is he in — and that is the right
 * shape for building a roster and the wrong one for setting a lineup. Nobody
 * chooses a lineup by going through their bench; they go down the seats and
 * ask who is in this one. Ten rows with a name in each is that question, and
 * the sum at the bottom is the answer it adds up to.
 *
 * It lives on the start/sit screen because a lineup is a decision about a
 * week, and this is the screen with a week on it. The button at the top is the
 * same question answered by the solver already drawing the advice below.
 *
 * `isSet` is the difference between a lineup and a suggestion. Until somebody
 * sets a week, what is on screen is the best lineup the roster could field —
 * a real answer, and not one anybody committed to. Saying so is the whole
 * reason a manager can leave fourteen weeks alone and trust them.
 */

export type LineupEntry = {
  playerId: number;
  name: string;
  position: string | null;
  nflTeam: string | null;
  injuryStatus: string | null;
  slot: string | null;
  points: number | null;
};

export type LineupSeat = {
  key: string;
  slot: string;
  player: LineupEntry | null;
};

export type LineupActions = {
  seat: (
    slot: string,
    incomingId: number | null,
    outgoingId: number | null,
  ) => Promise<{ error?: string }>;
  autoFill: () => Promise<{ error?: string }>;
};

/** The empty option's value. A select cannot hold null. */
const NOBODY = "";

function figure(value: number | null): string {
  return value === null ? "--" : value.toFixed(1);
}

export function LineupBoard({
  teamName,
  seats,
  roster,
  basis,
  week,
  isSet,
  disabled = false,
  actions,
}: {
  teamName: string;
  seats: LineupSeat[];
  /** Everyone on the roster, so a seat can be filled from the bench. */
  roster: LineupEntry[];
  /** What the figures are: this week's projection, or rest of season. */
  basis: "week" | "season";
  week: number | null;
  /** Whether anybody has actually set this week, or this is still the solver's. */
  isSet: boolean;
  disabled?: boolean;
  actions: LineupActions;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const run = (key: string, work: () => Promise<{ error?: string }>) => {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (result.error) setError(result.error);
    });
  };

  // How many seats each slot has, and where each seat falls among its own
  // kind. Both are read off the board rather than off the league's settings,
  // so a seat `seats()` had to invent for a stranded player is numbered too.
  const ordinals = new Map<string, number>();
  const nth = new Map<string, number>();
  for (const seat of seats) {
    const count = (ordinals.get(seat.slot) ?? 0) + 1;
    ordinals.set(seat.slot, count);
    nth.set(seat.key, count);
  }

  const seated = seats.filter((seat) => seat.player);
  const total = seated.reduce((sum, seat) => sum + (seat.player?.points ?? 0), 0);
  const unprojected = seated.filter((seat) => seat.player?.points === null).length;

  const unit =
    basis === "week" ? `projected · week ${week}` : "rest-of-season points";

  return (
    <Panel
      label={
        <>
          {`Lineup · week ${week} · ${teamName} · `}
          <span className={cn(!isSet && "text-grease")}>
            {isSet ? "set" : "best available"}
          </span>
        </>
      }
      note={`${
        isSet
          ? `This is the lineup set for week ${week}.`
          : `Nobody has set week ${week}, so this is the best lineup this roster could field — which is what every screen will score it as until you change something.`
      } The figure on a name is ${
        basis === "week"
          ? `what he is projected for in week ${week}, in this league's scoring`
          : "his rest-of-season projection — no weekly grid has been pulled for this week, so the lineup is solved on the season instead"
      }. Changing a seat moves whoever was in it: into the seat the new man came from where he fits it, and to the bench where he does not.`}
      action={
        <Button
          type="button"
          size="sm"
          disabled={disabled || busy !== null || roster.length === 0}
          onClick={() => run("auto", actions.autoFill)}
        >
          <WandSparkles aria-hidden />
          {busy === "auto" ? "Seating" : "Start the best lineup"}
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5">
        {roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody on this roster yet. Add players below and the seats fill in.
          </p>
        ) : (
          <>
            {seats.map((seat) => {
              // Everybody whose position can fill this seat. A man starting
              // elsewhere stays in the list: picking him is a swap, which is
              // the ordinary way a lineup gets rearranged.
              const eligible = roster.filter((player) =>
                slotFits(seat.slot, player.position),
              );

              return (
                <div
                  key={seat.key}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xs p-2",
                    "bg-[color-mix(in_oklch,var(--board-deep)_40%,transparent)]",
                  )}
                >
                  <Stencil className="w-14 shrink-0">{seat.slot}</Stencil>

                  {seat.player ? (
                    <PositionBadge position={seat.player.position} />
                  ) : (
                    <PositionBadge position={null} />
                  )}

                  <Select
                    // Numbered when the league has more than one of these, so
                    // a screen reader does not read "RB seat" twice and leave
                    // the listener with no way to tell which is which.
                    aria-label={
                      ordinals.get(seat.slot)! > 1
                        ? `${seat.slot} seat ${nth.get(seat.key)}`
                        : `${seat.slot} seat`
                    }
                    value={seat.player?.playerId ?? NOBODY}
                    disabled={disabled || busy !== null}
                    onChange={(event) =>
                      run(seat.key, () =>
                        actions.seat(
                          seat.slot,
                          event.target.value === NOBODY
                            ? null
                            : Number(event.target.value),
                          seat.player?.playerId ?? null,
                        ),
                      )
                    }
                    className="h-8 min-w-0 flex-1"
                  >
                    <option value={NOBODY}>&mdash; empty</option>
                    {eligible.map((player) => (
                      <option key={player.playerId} value={player.playerId}>
                        {player.name}
                        {player.slot && player.slot !== "BN"
                          ? ` (${player.slot})`
                          : ""}
                        {` · ${figure(player.points)}`}
                      </option>
                    ))}
                  </Select>

                  <InjuryBadge status={seat.player?.injuryStatus ?? null} />

                  <span
                    data-numeric
                    className={cn(
                      "w-12 shrink-0 text-right font-plate text-sm font-semibold tabular-nums",
                      seat.player?.points === undefined ||
                        seat.player?.points === null
                        ? "text-chalk-dim"
                        : "text-foreground",
                    )}
                  >
                    {figure(seat.player?.points ?? null)}
                  </span>
                </div>
              );
            })}

            <RailLine className="my-1" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                {error ? (
                  <GreaseNote tone="strike">{error}</GreaseNote>
                ) : unprojected > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {unprojected === 1
                      ? "One starter has no projection"
                      : `${unprojected} starters have no projection`}
                    , so this total is short of the lineup.
                  </p>
                ) : (
                  <Stencil>{unit}</Stencil>
                )}
              </div>

              <div className="flex items-baseline gap-2">
                <Stencil>Total</Stencil>
                <span
                  data-numeric
                  className="font-plate text-lg font-bold tabular-nums text-foreground"
                >
                  {total.toFixed(1)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

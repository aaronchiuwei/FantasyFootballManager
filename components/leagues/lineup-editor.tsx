"use client";

import { useMemo, useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { PositionBadge } from "@/components/values/position-badge";
import { formatLineup, numQbsFor, parseLineup } from "@/lib/leagues/manual-input";
import { cn } from "@/lib/utils";

/**
 * The slots a league can have, in lineup order.
 *
 * Fixed and ordered, which is what lets this be a set of counters rather than
 * a text box: the order of a lineup is a property of the sport, not of the
 * typing. A slot the list does not know about is still honoured — see
 * `extras` below — so opening the settings of an unusual league and saving it
 * cannot quietly delete a slot.
 */
const SLOT_ROWS: { slot: string; label: string; hint: string }[] = [
  { slot: "QB", label: "QB", hint: "Quarterback" },
  { slot: "RB", label: "RB", hint: "Running back" },
  { slot: "WR", label: "WR", hint: "Wide receiver" },
  { slot: "TE", label: "TE", hint: "Tight end" },
  { slot: "W/R/T", label: "FLEX", hint: "RB, WR or TE" },
  { slot: "Q/W/R/T", label: "SUPERFLEX", hint: "QB, RB, WR or TE" },
  { slot: "K", label: "K", hint: "Kicker" },
  { slot: "DEF", label: "DEF", hint: "Team defense" },
  { slot: "BN", label: "BENCH", hint: "Held, not started" },
  { slot: "IR", label: "IR", hint: "Injured reserve" },
];

const MAX_PER_SLOT = 20;

function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`One fewer ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon aria-hidden />
      </Button>
      <span
        data-numeric
        aria-live="polite"
        aria-label={`${value} ${label}`}
        className={cn(
          "w-6 text-center font-plate text-sm font-semibold tabular-nums",
          value === 0 ? "text-chalk-dim/50" : "text-foreground",
        )}
      >
        {value}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`One more ${label}`}
        disabled={value >= MAX_PER_SLOT}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon aria-hidden />
      </Button>
    </div>
  );
}

/**
 * The starting lineup, set by clicking.
 *
 * It posts the same string the parser has always read, in a hidden field —
 * `planManualSettings` and its tests are unchanged, and a league entered
 * through this editor is byte-identical to one that was typed. The counters
 * are a better way to ask the question, not a different question.
 *
 * Two things are shown rather than asked for, because the lineup already
 * answers them: how many players a team starts, and whether the league is
 * superflex. Both were derived before; now they are derived *visibly*, which
 * is what makes it safe not to have a superflex checkbox.
 */
export function LineupEditor({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [counts, setCounts] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const row of SLOT_ROWS) initial[row.slot] = 0;
    for (const slot of parseLineup(defaultValue).slots) {
      initial[slot.position] = slot.count;
    }
    return initial;
  });

  /**
   * Slots this editor has no row for, kept exactly as they were found.
   *
   * A `W/T` or a `Q/W/R` is a real league that the ten rows above do not
   * cover, and dropping it because the editor cannot draw it would mean
   * opening the settings screen and pressing Save silently changed the
   * league's replacement ranks.
   */
  const extras = useMemo(
    () =>
      parseLineup(defaultValue).slots.filter(
        (slot) => !SLOT_ROWS.some((row) => row.slot === slot.position),
      ),
    [defaultValue],
  );

  // Rebuilt as a lineup string in the canonical order, which is the order the
  // rows are drawn in — so what is posted reads the way the screen reads.
  const lineup = useMemo(() => {
    const ordered = SLOT_ROWS.filter((row) => (counts[row.slot] ?? 0) > 0).map(
      (row) => ({
        position: row.slot,
        positionType: null,
        count: counts[row.slot],
        isStarting: row.slot !== "BN" && row.slot !== "IR",
      }),
    );
    return formatLineup([...ordered, ...extras]);
  }, [counts, extras]);

  const parsed = useMemo(() => parseLineup(lineup).slots, [lineup]);
  const starters = parsed
    .filter((slot) => slot.isStarting)
    .reduce((total, slot) => total + slot.count, 0);
  const bench = parsed
    .filter((slot) => !slot.isStarting)
    .reduce((total, slot) => total + slot.count, 0);
  const superflex = numQbsFor(parsed) === 2;

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={lineup} />

      <ul className="flex flex-col rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] px-3 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]">
        {SLOT_ROWS.map((row, index) => (
          <li key={row.slot}>
            <div className="flex items-center gap-2.5 py-2">
              <PositionBadge
                position={row.slot === "W/R/T" || row.slot === "Q/W/R/T" ? "" : row.slot}
                className="w-14"
              />
              <div className="min-w-0 flex-1">
                <p className="font-plate text-sm font-semibold text-foreground">
                  {row.label}
                </p>
                <Stencil className="mt-0.5 block">{row.hint}</Stencil>
              </div>
              <Stepper
                value={counts[row.slot] ?? 0}
                label={row.label}
                onChange={(next) =>
                  setCounts((current) => ({ ...current, [row.slot]: next }))
                }
              />
            </div>
            {index < SLOT_ROWS.length - 1 ? <RailLine /> : null}
          </li>
        ))}
      </ul>

      {extras.length > 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          This league also has {formatLineup(extras)}, which this editor cannot
          change. It is kept as it is.
        </p>
      ) : null}

      <p
        data-numeric
        className="stencil tabular-nums text-chalk-dim"
        aria-live="polite"
      >
        {starters} starters · {bench} bench and IR
        {superflex ? " · superflex" : ""}
      </p>
    </div>
  );
}

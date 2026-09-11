"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { GreaseNote, Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import {
  scheduleRows,
  type SchedulePair,
} from "@/lib/matchups/manual-input";
import { cn } from "@/lib/utils";

/**
 * Who plays whom, typed in.
 *
 * A hand-kept league has nobody to ask, and the matchup screen's answer to
 * that used to be an empty state. This is the same screen admitting that the
 * manager knows the answer and has nowhere to put it.
 *
 * One row per matchup, two selectors each, and a team already spoken for drops
 * out of every other row's list — which is the whole validation story made
 * visible rather than a sentence printed after a failed save. The server
 * checks it again anyway, because a form is not a place to keep an invariant.
 *
 * Scores are deliberately absent. The rosters are already here and so is the
 * weekly stat grid, so entering the schedule is enough to get live scoring;
 * asking anybody to key in points on a Sunday would be asking for work the app
 * is already doing.
 */

export type ScheduleTeam = { id: string; name: string };

export type ScheduleActions = {
  save: (pairs: SchedulePair[]) => Promise<{ error?: string }>;
  clear: () => Promise<{ error?: string }>;
};

/** The empty option's value. A select cannot hold null. */
const NOBODY = "";

function toRows(
  teams: ScheduleTeam[],
  existing: SchedulePair[],
): SchedulePair[] {
  const rows = Math.max(scheduleRows(teams.length), existing.length);
  return Array.from({ length: rows }, (_, index) => ({
    a: existing[index]?.a ?? null,
    b: existing[index]?.b ?? null,
  }));
}

export function ScheduleEditor({
  week,
  teams,
  existing,
  actions,
}: {
  week: number;
  teams: ScheduleTeam[];
  /** The week as it stands, one entry per matchup already saved. */
  existing: SchedulePair[];
  actions: ScheduleActions;
}) {
  const [rows, setRows] = useState<SchedulePair[]>(() =>
    toRows(teams, existing),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (index: number, side: "a" | "b", value: string) => {
    setSaved(false);
    setRows((current) =>
      current.map((row, at) =>
        at === index ? { ...row, [side]: value === NOBODY ? null : value } : row,
      ),
    );
  };

  /**
   * Everybody this row may still choose: the teams nobody else has claimed,
   * plus whoever is in this seat already so that reopening a list does not
   * hide the choice it is showing.
   */
  const optionsFor = (index: number, side: "a" | "b") => {
    const taken = new Set<string>();
    rows.forEach((row, at) => {
      for (const key of ["a", "b"] as const) {
        if (at === index && key === side) continue;
        if (row[key]) taken.add(row[key]!);
      }
    });

    return teams.filter((team) => !taken.has(team.id));
  };

  const run = (work: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  };

  const placed = rows.filter((row) => row.a || row.b).length;
  const unplaced = teams.filter(
    (team) => !rows.some((row) => row.a === team.id || row.b === team.id),
  );

  return (
    <Panel
      label={`Schedule · week ${week}`}
      note="Who plays whom, for this week only. Leave one side of a row empty to give a team a bye, and leave a whole row empty if the league is short one matchup. Scores are not typed in — they add up from the rosters as the week is played."
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => run(actions.clear)}
        >
          Clear week
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        {teams.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            This league needs at least two teams before it can have a schedule.
            They are added on the manage screen.
          </p>
        ) : (
          <>
            {rows.map((row, index) => (
              <div
                key={index}
                className={cn(
                  "flex items-center gap-2 rounded-xs p-2",
                  "bg-[color-mix(in_oklch,var(--board-deep)_40%,transparent)]",
                )}
              >
                <Stencil data-numeric className="w-4 shrink-0 tabular-nums">
                  {index + 1}
                </Stencil>

                <Select
                  aria-label={`Matchup ${index + 1}, first team`}
                  value={row.a ?? NOBODY}
                  disabled={pending}
                  onChange={(event) => set(index, "a", event.target.value)}
                  className="h-8 min-w-0 flex-1"
                >
                  <option value={NOBODY}>&mdash;</option>
                  {optionsFor(index, "a").map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>

                <Stencil className="shrink-0">v</Stencil>

                <Select
                  aria-label={`Matchup ${index + 1}, second team`}
                  value={row.b ?? NOBODY}
                  disabled={pending}
                  onChange={(event) => set(index, "b", event.target.value)}
                  className="h-8 min-w-0 flex-1"
                >
                  <option value={NOBODY}>&mdash; bye</option>
                  {optionsFor(index, "b").map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </div>
            ))}

            <RailLine />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="min-w-0">
                {error ? (
                  <GreaseNote tone="strike">{error}</GreaseNote>
                ) : saved ? (
                  <GreaseNote>Week {week} saved.</GreaseNote>
                ) : unplaced.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Not in a matchup yet:{" "}
                    {unplaced.map((team) => team.name).join(", ")}.
                  </p>
                ) : (
                  <Stencil data-numeric className="tabular-nums">
                    {placed} matchup{placed === 1 ? "" : "s"} · every team placed
                  </Stencil>
                )}
              </div>

              <Button
                type="button"
                disabled={pending || placed === 0}
                onClick={() => run(() => actions.save(rows))}
              >
                {pending ? "Saving" : `Save week ${week}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

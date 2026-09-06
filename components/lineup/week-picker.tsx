import Link from "next/link";

import { Stencil } from "@/components/board/panel";
import { cn } from "@/lib/utils";

/**
 * The league's own weeks, as a rail of chips.
 *
 * Links rather than a control, so the whole screen is a server render with no
 * JavaScript in it and a week is a URL somebody can send to a league mate. It
 * scrolls horizontally for the same reason the section nav does: eighteen
 * chips do not fit on a phone, and a picker that reflows to three lines pushes
 * the lineup below the fold.
 *
 * The live week is marked separately from the selected one. They are usually
 * the same and the two times they are not are exactly when it matters: looking
 * back at a week already played, and looking ahead at one that has not
 * arrived.
 */
export function WeekPicker({
  leagueId,
  weeks,
  week,
  currentWeek,
}: {
  leagueId: string;
  weeks: number[];
  week: number;
  /** The live NFL week, where the season clock knows one. */
  currentWeek: number | null;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
      <div className="rail flex w-max min-w-full items-center gap-1 rounded-xs px-2 py-1.5">
        <Stencil className="shrink-0 px-1.5">Week</Stencil>

        {weeks.map((entry) => {
          const selected = entry === week;
          const live = entry === currentWeek;

          return (
            <Link
              key={entry}
              href={`/leagues/${leagueId}/lineup?week=${entry}`}
              aria-current={selected ? "page" : undefined}
              title={
                live
                  ? `Week ${entry}, the live week`
                  : currentWeek !== null && entry < currentWeek
                    ? `Week ${entry}, already played`
                    : `Week ${entry}`
              }
              data-numeric
              className={cn(
                "chip relative shrink-0 tabular-nums",
                selected ? "chip-on" : "chip-off",
                !selected &&
                  live &&
                  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--grease)_55%,transparent)]",
              )}
            >
              {entry}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

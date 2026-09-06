import Link from "next/link";

import { Stencil } from "@/components/board/panel";
import type { WeekTeam } from "@/lib/lineup/store";
import { isOptimal } from "@/lib/lineup/weekly";
import { cn } from "@/lib/utils";

import { points, signedPoints } from "./team-week-column";

/**
 * Every team's week as one figure, ranked.
 *
 * The columns below say who scores it; this says how much, against the other
 * eleven. It is the only place in the app where teams are ordered by what they
 * are about to do rather than by what they have done or what their roster is
 * worth, and the two orders disagree often enough to be worth the strip: a
 * first-place team with three byes is a first-place team projected tenth.
 *
 * The bars share one drawn axis rather than each carrying its own. A scale per
 * row would be twelve identical rulers, and the thing being compared here is
 * the rows against each other, which is exactly what a common axis is for.
 */
export function ProjectionBoard({
  teams,
  leagueId,
  week,
  played,
}: {
  teams: WeekTeam[];
  leagueId: string;
  week: number;
  played: boolean;
}) {
  // Ranked on what is slotted now, not on the optimal lineup: the question is
  // what these teams are about to put on the field, and a manager who leaves
  // his best receiver benched really is projected lower.
  const ranked = [...teams].sort(
    (a, b) => b.lineup.current.points - a.lineup.current.points,
  );

  const max = ranked.reduce(
    (highest, team) => Math.max(highest, team.lineup.best.points),
    0,
  );
  const axis = max > 0 ? Math.ceil(max / 10) * 10 : 10;

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2 pb-1">
        <Stencil className="w-5 shrink-0 text-right">#</Stencil>
        <Stencil className="min-w-0 flex-1">Team</Stencil>
        <Stencil className="w-16 shrink-0 text-right">
          {played ? "Scored" : "Proj"}
        </Stencil>
        <Stencil className="w-20 shrink-0 text-right">Available</Stencil>
      </div>

      {ranked.map((team, index) => {
        const { lineup } = team;
        const settled = isOptimal(lineup);
        const share = Math.max(0, Math.min(100, (lineup.current.points / axis) * 100));
        const bestShare = Math.max(
          0,
          Math.min(100, (lineup.best.points / axis) * 100),
        );

        return (
          <div
            key={team.id}
            className={cn(
              "flex items-center gap-2 rounded-xs py-1.5",
              team.isUsersTeam &&
                "bg-[color-mix(in_oklch,var(--grease)_10%,transparent)] px-1.5",
            )}
          >
            <span
              data-numeric
              className={cn(
                "stencil w-5 shrink-0 text-right tabular-nums",
                team.isUsersTeam ? "text-grease" : "text-chalk-dim",
              )}
            >
              {index + 1}
            </span>

            <div className="min-w-0 flex-1">
              <Link
                href={`/leagues/${leagueId}/values?team=${team.id}`}
                className="truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
              >
                {team.name}
              </Link>

              <div
                className={cn(
                  "relative mt-1 h-2 w-full overflow-hidden rounded-xs",
                  "bg-[color-mix(in_oklch,var(--board-deep)_55%,transparent)]",
                  "shadow-[inset_0_1px_2px_color-mix(in_oklch,var(--board-deep)_70%,transparent)]",
                )}
                role="meter"
                aria-valuenow={Math.round(lineup.current.points * 10) / 10}
                aria-valuemin={0}
                aria-valuemax={axis}
                aria-label={`${team.name} projected points, week ${week}`}
              >
                {/* What the roster could reach, drawn behind what it is set to
                    score. The gap between the two IS the advice, at a glance. */}
                <div
                  className="absolute inset-y-0 left-0 bg-[color-mix(in_oklch,var(--grease)_35%,transparent)]"
                  style={{ width: `${bestShare}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 bg-[var(--channel-lip)] transition-[width] duration-(--motion-slow) ease-(--ease-out) motion-reduce:transition-none"
                  style={{ width: `${share}%` }}
                />
                <div aria-hidden className="graticule absolute inset-0" />
              </div>
            </div>

            <span
              data-numeric
              className="w-16 shrink-0 text-right font-plate text-sm font-bold tabular-nums text-foreground"
            >
              {points(played ? lineup.current.actual : lineup.current.points)}
            </span>

            <span
              data-numeric
              className={cn(
                "w-20 shrink-0 text-right font-plate text-sm tabular-nums",
                settled ? "text-chalk-dim" : "text-grease",
              )}
              title={
                settled
                  ? "This lineup is already the best one on the roster."
                  : `The best lineup on this roster is worth ${points(lineup.best.points)}.`
              }
            >
              {settled ? "--" : signedPoints(lineup.gain)}
            </span>
          </div>
        );
      })}

      {/* The one axis all twelve bars are measured on. */}
      <div className="mt-1 flex justify-between pl-7">
        <Stencil className="text-[0.5625rem]">0</Stencil>
        <Stencil data-numeric className="text-[0.5625rem] tabular-nums">
          {axis} pts
        </Stencil>
      </div>
    </div>
  );
}

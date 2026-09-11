import Link from "next/link";

import { Stencil } from "@/components/board/panel";
import { cn } from "@/lib/utils";

/**
 * Whose lineup is being set.
 *
 * A hand-kept league is one person keeping twelve teams, so "your team" is the
 * wrong scope for the one control that writes a lineup: the manager entering
 * the league is the manager of all of it, and a board that only ever offered
 * their own roster would leave eleven lineups unsettable.
 *
 * Links rather than a control, so the screen stays a server render and a
 * particular team's week is a URL. The week rides along, because moving
 * between teams to compare the same week is the thing this is for.
 */
export function TeamPicker({
  leagueId,
  week,
  teams,
  selectedId,
}: {
  leagueId: string;
  week: number;
  teams: { id: string; name: string; isUsersTeam: boolean }[];
  selectedId: string;
}) {
  if (teams.length < 2) return null;

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
      <div className="rail flex w-max min-w-full items-center gap-1 rounded-xs px-2 py-1.5">
        <Stencil className="shrink-0 px-1.5">Team</Stencil>

        {teams.map((team) => {
          const selected = team.id === selectedId;

          return (
            <Link
              key={team.id}
              href={`/leagues/${leagueId}/lineup?week=${week}&team=${team.id}`}
              aria-current={selected ? "page" : undefined}
              title={team.isUsersTeam ? `${team.name} — your team` : team.name}
              className={cn(
                "chip max-w-[12rem] shrink-0 truncate",
                selected ? "chip-on" : "chip-off",
                !selected &&
                  team.isUsersTeam &&
                  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--grease)_55%,transparent)]",
              )}
            >
              {team.name}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

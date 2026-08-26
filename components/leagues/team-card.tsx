import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TeamRow = {
  id: string;
  name: string;
  manager_name: string | null;
  logo_url: string | null;
  is_users_team: boolean;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  points_for: number | null;
  points_against: number | null;
  rank: number | null;
};

function record(team: TeamRow) {
  if (team.wins === null && team.losses === null) return "No games played";
  const base = `${team.wins ?? 0}-${team.losses ?? 0}`;
  return team.ties ? `${base}-${team.ties}` : base;
}

function points(value: number | null) {
  return value === null ? "0.0" : value.toFixed(1);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A team is not a player, so a team is not a plate: bone stock in this app
 * means one thing and it means it everywhere. A team is a column of the board,
 * shown here as a recessed slot with its standing stamped at the head.
 *
 * The user's own team is marked in grease pencil rather than by a coloured
 * edge, which is how everything else on this board marks the current thing.
 *
 * No transition on the container: it has no hover state, so the
 * `transition-colors` that used to sit here animated nothing. Where motion
 * does not serve comprehension, cut it.
 */
export function TeamCard({
  team,
  leagueId,
}: {
  team: TeamRow;
  leagueId: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xs p-3",
        "bg-[color-mix(in_oklch,var(--board-deep)_40%,transparent)]",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]",
        team.is_users_team &&
          "bg-[color-mix(in_oklch,var(--grease)_9%,color-mix(in_oklch,var(--board-deep)_40%,transparent))]",
      )}
    >
      <span
        data-numeric
        className={cn(
          "stencil w-5 shrink-0 pt-1.5 text-right tabular-nums",
          team.is_users_team ? "text-grease" : "text-chalk-dim",
        )}
      >
        {team.rank ?? "--"}
      </span>

      <Avatar className="size-9 shrink-0 rounded-xs after:rounded-xs">
        {team.logo_url ? <AvatarImage src={team.logo_url} alt="" /> : null}
        <AvatarFallback className="stencil rounded-xs text-[0.625rem]">
          {initials(team.name)}
        </AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          {/* The roster, as a filtered values board, and from any row there,
              that player's stats. */}
          <Link
            href={`/leagues/${leagueId}/values?team=${team.id}`}
            className="truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {team.name}
          </Link>
          {team.is_users_team ? <Badge className="shrink-0">You</Badge> : null}
        </div>

        <p className="truncate text-xs text-muted-foreground">
          {team.manager_name ?? "Manager hidden"}
        </p>

        <div
          data-numeric
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-0.5"
        >
          <span className="stencil tabular-nums text-foreground">
            {record(team)}
          </span>
          <span className="stencil tabular-nums text-chalk-dim">
            PF {points(team.points_for)}
          </span>
          <span className="stencil tabular-nums text-chalk-dim">
            PA {points(team.points_against)}
          </span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import type { CachedCycle, SuggestionTeamRow } from "@/lib/suggestions/store";
import { cn } from "@/lib/utils";

import { CycleCard } from "./cycle-card";

function Filter({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "chip max-w-[12rem] truncate",
        active ? "chip-on" : "chip-off",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Requirement 11's answer: the three-team cycles this league's rosters allow,
 * filtered to the team asking.
 *
 * The filter is not decoration here, the way it is on §9's win-win board. The
 * search itself is **anchored** — it runs once per team and asks "which cycles
 * could this team be in" — so a row belongs to exactly one team's menu rather
 * than to two teams' at once. Switching the filter is switching between twelve
 * searches that already ran in sync stage 8, which is why it is a `useMemo` and
 * not a request.
 *
 * A list rather than §9's card stack. A cycle card is three ledgers wide and
 * there are at most five of them a team; stacking cards that tall behind each
 * other to save vertical space would hide the comparison that makes a menu
 * worth having.
 */
export function CycleBoard({
  leagueId,
  teams,
  cycles,
  searched,
}: {
  leagueId: string;
  teams: SuggestionTeamRow[];
  cycles: CachedCycle[];
  /** False when no sync has computed a value board yet — see below. */
  searched: boolean;
}) {
  const [teamId, setTeamId] = useState<string | null>(
    () =>
      teams.find((team) => team.isUsersTeam)?.id ??
      cycles[0]?.anchorTeamId ??
      teams[0]?.id ??
      null,
  );

  const names = useMemo(
    () => Object.fromEntries(teams.map((team) => [team.id, team.name])),
    [teams],
  );

  const counts = useMemo(() => {
    const byTeam = new Map<string, number>();
    for (const cycle of cycles) {
      byTeam.set(cycle.anchorTeamId, (byTeam.get(cycle.anchorTeamId) ?? 0) + 1);
    }
    return byTeam;
  }, [cycles]);

  const shown = useMemo(
    () =>
      teamId === null
        ? cycles
        : cycles.filter((cycle) => cycle.anchorTeamId === teamId),
    [cycles, teamId],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {teams.map((team) => (
          <Filter
            key={team.id}
            active={teamId === team.id}
            onClick={() => setTeamId(team.id)}
          >
            {team.name}
            {team.isUsersTeam ? " (you)" : ""} ({counts.get(team.id) ?? 0})
          </Filter>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {/* Two different claims, and they must not render the same way. */}
          {searched
            ? "No three-team cycle for this team is fair for all three managers and better for all three lineups. That is the usual answer. A cycle has to solve three rosters at once, and most leagues do not contain one."
            : "Nothing searched yet. A sync prices every roster and then looks for cycles."}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((cycle) => (
            <CycleCard
              key={cycle.id}
              cycle={cycle.payload}
              leagueId={leagueId}
              names={names}
            />
          ))}
        </div>
      )}
    </div>
  );
}

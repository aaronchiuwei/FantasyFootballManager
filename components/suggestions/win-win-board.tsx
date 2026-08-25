"use client";

import { useMemo, useState } from "react";

import type { CachedSuggestion, SuggestionTeamRow } from "@/lib/suggestions/store";
import { cn } from "@/lib/utils";

import { PackageStack } from "./package-stack";

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
        "inline-flex h-7 max-w-[12rem] items-center truncate rounded-4xl border px-3 text-xs font-medium transition-colors motion-reduce:transition-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Requirement 9's answer, as a board: every trade in this league that is fair
 * by value *and* leaves both starting lineups better than it found them,
 * ranked by the smaller of the two gains.
 *
 * The search itself ran in sync stage 8 — it is a fold over every pair of
 * rosters, which is the definition of work that belongs to a sync (§9) — so
 * everything here is already in memory and the filter is a `useMemo`, not a
 * request. Same arrangement as the waiver board next door, for the same reason:
 * the server is asked once.
 *
 * The filter defaults to the user's own team because that is the question
 * anyone opening this page has. The rest of the league is one click away and
 * genuinely interesting — knowing that two other managers have an obvious
 * win-win sitting between them is a reason to get there first.
 */
export function WinWinBoard({
  leagueId,
  teams,
  suggestions,
}: {
  leagueId: string;
  teams: SuggestionTeamRow[];
  suggestions: CachedSuggestion[];
}) {
  const [teamId, setTeamId] = useState<string | null>(
    () => teams.find((team) => team.isUsersTeam)?.id ?? null,
  );

  const names = useMemo(
    () => Object.fromEntries(teams.map((team) => [team.id, team.name])),
    [teams],
  );

  const shown = useMemo(() => {
    const filtered =
      teamId === null
        ? suggestions
        : suggestions.filter(
            (entry) => entry.teamA === teamId || entry.teamB === teamId,
          );

    return filtered.map((entry) => entry.payload);
  }, [suggestions, teamId]);

  const counts = useMemo(() => {
    const byTeam = new Map<string, number>();
    for (const entry of suggestions) {
      byTeam.set(entry.teamA, (byTeam.get(entry.teamA) ?? 0) + 1);
      byTeam.set(entry.teamB, (byTeam.get(entry.teamB) ?? 0) + 1);
    }
    return byTeam;
  }, [suggestions]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter active={teamId === null} onClick={() => setTeamId(null)}>
          Whole league ({suggestions.length})
        </Filter>
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

      <PackageStack
        packages={shown}
        leagueId={leagueId}
        names={names}
        emptyLabel={
          teamId === null
            ? "No trade in this league is both fair by value and better for both lineups."
            : "Nothing for this team. Every fair trade available to them costs one side more lineup than it pays."
        }
      />
    </div>
  );
}

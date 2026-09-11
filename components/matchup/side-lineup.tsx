import Link from "next/link";

import { Stencil } from "@/components/board/panel";
import { EmptySeat, RailLine } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { matchupLabel, points } from "@/components/lineup/team-week-column";
import type { MatchupSide } from "@/lib/matchups/board";
import type { MatchupPhase } from "@/lib/matchups/live";
import type { MatchupTeam } from "@/lib/matchups/store";
import { cn } from "@/lib/utils";

/**
 * One side's starting lineup, read as a matchup rather than as a decision.
 *
 * The start/sit board draws the same names to answer whether the lineup is
 * right. This draws them to answer where the points are coming from, so the
 * verdicts are gone and the split is the one that matters on a Sunday: the men
 * who are done, at what they actually scored, and the men still to come, at
 * what they are still projected for.
 *
 * Both figures stay on a played row. "He scored 6.1" is the fact; "he was
 * projected 14.2" is why the side is behind, and dropping it would leave the
 * manager reading a deficit with no account of where it came from.
 *
 * The one row that changes with the phase is the starter with no stat line.
 * Mid-afternoon he is a man still to come, carrying his projection. Once the
 * week is over he is a man who never played, and printing what he was
 * projected for as though it were still owed would be a promise about a week
 * that has already happened.
 */

function StarterRow({
  player,
  leagueId,
  phase,
}: {
  player: MatchupTeam["players"][number];
  leagueId: string;
  phase: MatchupPhase;
}) {
  const done = player.actual !== null;
  const missed = !done && phase === "final";

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <PositionBadge position={player.position} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/leagues/${leagueId}/players/${player.playerId}`}
            className="truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {player.name}
          </Link>
          <InjuryBadge status={player.injuryStatus} />
        </div>

        <p
          className={cn(
            "stencil truncate",
            player.onBye ? "text-warning" : "text-chalk-dim",
          )}
        >
          {matchupLabel(player)}
          {player.slot ? ` · ${player.slot}` : ""}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <span
          data-numeric
          className={cn(
            "block font-plate text-sm tabular-nums",
            done ? "font-bold text-foreground" : "text-chalk-dim",
          )}
          title={
            done
              ? "What he has scored so far. A line exists for him, which is the only signal either provider gives that his game has started."
              : missed
                ? "The week is over and no stat line ever landed for him. Whatever the league credited for him is already in the score above."
                : player.onBye
                  ? "On bye. No projection, and no points either way."
                  : player.points === null
                    ? "Nothing projects him this week, so this side's projected final is short of him."
                    : "Projected, and still to play."
          }
        >
          {points(done ? player.actual : missed ? null : player.points)}
        </span>

        <Stencil data-numeric className="block tabular-nums">
          {done
            ? `proj ${points(player.points)}`
            : missed
              ? "no line"
              : player.onBye
                ? "bye"
                : "to play"}
        </Stencil>
      </div>
    </div>
  );
}

export function SideLineup({
  side,
  leagueId,
  label,
  phase,
}: {
  side: MatchupSide<MatchupTeam>;
  leagueId: string;
  /** Which half of the matchup this is, stencilled on the column head. */
  label: string;
  phase: MatchupPhase;
}) {
  // The same array the odds were computed from. Reading the lineup back off
  // `team.lineup` instead would be a second path to the same list, and two
  // paths to one list is how a screen ends up disagreeing with itself.
  const starters = side.team.starters;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between gap-2 pb-1">
        <Stencil>{label}</Stencil>
        <Stencil data-numeric className="tabular-nums">
          {side.live.played} of {starters.length} played
        </Stencil>
      </div>
      <RailLine />

      {starters.length === 0 ? (
        <EmptySeat className="mt-2">No lineup read for this week</EmptySeat>
      ) : (
        starters.map((player) => (
          <StarterRow
            key={player.playerId}
            player={player}
            leagueId={leagueId}
            phase={phase}
          />
        ))
      )}
    </div>
  );
}

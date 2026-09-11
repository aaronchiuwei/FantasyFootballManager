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
 * Two figures on every row, in the same two places on every row: what he has
 * scored above, what he was projected for below. That is the point of the
 * column — "he scored 6.1" is the fact, "he was projected 14.2" is why the
 * side is behind, and the two only answer each other when they are always both
 * there and always the same way round.
 *
 * The earlier form put a word where the second figure goes — `to play`, `bye`,
 * `no line` — which read as a status column that happened to contain numbers
 * some of the time. A man still to come has a projection like everybody else;
 * what he does not have is a score, and a dash in the score's place says that
 * more plainly than a phrase in the projection's place ever did. What he is on
 * bye or hurt or benched for is already on his line, in the meta beside his
 * name, where it does not cost a figure its seat.
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

  /**
   * What he has banked.
   *
   * Null prints as a dash: no line has landed, so there is no score to state,
   * and a zero there would be a claim that he played and did nothing. A week
   * that has not started is the exception — nobody is waiting on anybody, every
   * score in it really is zero, and a column of dashes over a fixture three
   * weeks out says nothing a reader did not already know from the date.
   */
  const scored = player.actual ?? (phase === "upcoming" ? 0 : null);

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
              : phase === "upcoming"
                ? "The week has not started, so nobody has scored anything yet."
                : phase === "final"
                  ? "The week is over and no stat line ever landed for him. Whatever the league credited for him is already in the score above."
                  : player.onBye
                    ? "On bye. He will not play this week, so no score is coming."
                    : "No line yet, so nothing to show. His game has not started, or the feed has not caught up with it."
          }
        >
          {points(scored)}
        </span>

        <Stencil
          data-numeric
          className="block tabular-nums"
          title={
            player.points === null
              ? player.onBye
                ? "On bye. Nothing projects a player who is not playing."
                : "Nothing projects him this week, so this side's projected final is short of him."
              : "What this week's grid projects him for, in this league's scoring."
          }
        >
          proj {points(player.points)}
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

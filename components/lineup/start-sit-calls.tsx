import Link from "next/link";

import { Panel, Stencil } from "@/components/board/panel";
import { EmptySeat, Rail } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import type { WeekRosterPlayer, WeekTeam } from "@/lib/lineup/store";
import { isOptimal, type StartSitMove } from "@/lib/lineup/weekly";
import { cn } from "@/lib/utils";

import { matchupLabel, points, signedPoints } from "./team-week-column";

/**
 * One team's start/sit calls for the week, spelled out.
 *
 * The board below draws the same verdicts in place, beside each name, which is
 * the right form for twelve rosters at a glance and the wrong one for the
 * decision the manager came here to make. This is that decision, written as
 * what it is: a swap, the two men in it, what each is projected for, and what
 * the change is worth.
 *
 * The pairing is a decomposition rather than an instruction. Every legal
 * arrangement of the same names scores the same, so what is being claimed is
 * "these come in, those go out, and the difference is this" — which is exactly
 * what the gains sum to.
 */

function MoveSide({
  kind,
  player,
  leagueId,
}: {
  kind: "start" | "sit";
  player: WeekRosterPlayer | null;
  leagueId: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Stencil
        tone={kind === "start" ? "grease" : "dim"}
        className="w-8 shrink-0"
      >
        {kind === "start" ? "In" : "Out"}
      </Stencil>

      {player === null ? (
        <span className="stencil min-w-0 flex-1 truncate text-chalk-dim">
          {kind === "start" ? "Nobody eligible" : "Slot was empty"}
        </span>
      ) : (
        <>
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
            </p>
          </div>

          {/* Fixed width so the two figures line up under each other when the
              rail stacks on a phone: a swap is a comparison, and two numbers
              that do not share a right edge are not one. */}
          <span
            data-numeric
            className={cn(
              "w-10 shrink-0 text-right font-plate text-sm tabular-nums",
              player.points === null ? "text-chalk-dim" : "text-foreground",
            )}
          >
            {points(player.points)}
          </span>
        </>
      )}
    </div>
  );
}

function Move({
  move,
  leagueId,
}: {
  move: StartSitMove<WeekRosterPlayer>;
  leagueId: string;
}) {
  return (
    <Rail
      label={move.slot ?? "Slot"}
      meta={signedPoints(move.gain)}
      className="items-center"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        <MoveSide kind="start" player={move.start} leagueId={leagueId} />
        <MoveSide kind="sit" player={move.sit} leagueId={leagueId} />
      </div>
    </Rail>
  );
}

export function StartSitCalls({
  team,
  leagueId,
  week,
  /** True once the week is behind the live one, so the advice is retrospective. */
  played,
}: {
  team: WeekTeam;
  leagueId: string;
  week: number;
  played: boolean;
}) {
  const { lineup } = team;
  const settled = isOptimal(lineup);

  const note = settled
    ? `Nothing on the bench beats what is in the lineup by enough to be worth the click. The best this roster can do is ${points(lineup.best.points)} and it is already putting out ${points(lineup.current.points)}.`
    : `${lineup.moves.length} change${lineup.moves.length === 1 ? "" : "s"} takes ${team.name} from ${points(lineup.current.points)} to ${points(lineup.best.points)} projected points. Solved against this league's own starting slots, on this week's projection grid.`;

  return (
    <Panel
      label={`Start / sit · week ${week} · ${team.name}`}
      note={played ? `${note} This week has been played, so this is what the lineup should have been.` : note}
      action={
        <div className="text-right">
          <p
            data-numeric
            className={cn(
              "font-plate text-2xl font-bold tabular-nums",
              settled ? "text-foreground" : "text-grease",
            )}
          >
            {settled ? points(lineup.current.points) : signedPoints(lineup.gain)}
          </p>
          <Stencil className="block">
            {settled ? "projected points" : "points available"}
          </Stencil>
        </div>
      }
    >
      {settled ? (
        <EmptySeat className="min-h-14">Lineup is already the best one</EmptySeat>
      ) : (
        <div className="flex flex-col gap-2">
          {lineup.moves.map((move, index) => (
            <Move
              key={`${move.start?.playerId ?? "none"}-${move.sit?.playerId ?? "none"}-${index}`}
              move={move}
              leagueId={leagueId}
            />
          ))}
        </div>
      )}

      {lineup.current.onBye > 0 ? (
        <p className="pt-3 text-xs text-muted-foreground">
          {lineup.current.onBye} player{lineup.current.onBye === 1 ? "" : "s"} in
          the lineup {lineup.current.onBye === 1 ? "is" : "are"} on bye this
          week. A bye has no projection at all, which is why the swap above is
          worth the whole of the replacement.
        </p>
      ) : null}
    </Panel>
  );
}

import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Stencil } from "@/components/board/panel";
import { EmptySeat, RailLine } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import type { RosterBand } from "@/lib/leagues/rosters";
import type { WeekRosterPlayer, WeekTeam } from "@/lib/lineup/store";
import { isOptimal, verdicts, type WeekVerdict } from "@/lib/lineup/weekly";
import { cn } from "@/lib/utils";

/**
 * One team's week: what it is projected to score, who scores it, and where the
 * lineup disagrees with the roster as it stands.
 *
 * Built on the overview's roster column deliberately — same bands, same
 * ordering, same plate-flat rows — because it is the same list of names read
 * for a different question, and a manager should not have to relearn a roster
 * to read it. What is new is the third column: the week's projection, and a
 * grease mark next to the two or three names the optimal lineup would move.
 *
 * The verdict is drawn beside the player rather than only in the summary above
 * him. "Sit him" next to a name is a decision; a name in a list somewhere else
 * is a lookup.
 */

const BANDS: { key: RosterBand; label: string }[] = [
  { key: "starting", label: "Starting" },
  { key: "bench", label: "Bench" },
  { key: "reserve", label: "Reserve" },
];

const VERDICT_STYLES: Record<WeekVerdict, string> = {
  start: "bg-[color-mix(in_oklch,var(--grease)_18%,transparent)] text-grease",
  sit: "bg-destructive/12 text-destructive",
};

const VERDICT_WORDS: Record<WeekVerdict, string> = {
  start: "Start",
  sit: "Sit",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Weekly points are a one-decimal quantity; a rounded 14 hides the whole margin. */
export function points(value: number | null): string {
  return value === null ? "--" : value.toFixed(1);
}

export function signedPoints(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}`;
}

/** Who he plays, or the reason he does not. */
export function matchupLabel(player: WeekRosterPlayer): string {
  if (player.onBye) return "BYE";
  if (!player.opponent) return player.nflTeam ?? "FA";
  return `${player.nflTeam ?? "FA"} ${player.isHome ? "vs" : "at"} ${player.opponent}`;
}

function PlayerRow({
  player,
  leagueId,
  verdict,
  showActual,
}: {
  player: WeekRosterPlayer;
  leagueId: string;
  verdict: WeekVerdict | undefined;
  /** Once the week is played, what happened matters more than what was said. */
  showActual: boolean;
}) {
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

        <div className="flex min-w-0 items-center gap-2">
          <p
            className={cn(
              "stencil min-w-0 truncate",
              player.onBye ? "text-warning" : "text-chalk-dim",
            )}
          >
            {matchupLabel(player)}
            {player.slot ? ` · ${player.slot}` : ""}
          </p>

          {verdict ? (
            <span
              className={cn(
                "stencil inline-flex h-5 shrink-0 items-center rounded-xs px-1.5 text-[0.5625rem]",
                VERDICT_STYLES[verdict],
              )}
            >
              {VERDICT_WORDS[verdict]}
            </span>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <span
          data-numeric
          className={cn(
            "block font-plate text-sm tabular-nums",
            player.points === null ? "text-chalk-dim" : "text-foreground",
          )}
          title={
            player.points === null
              ? player.onBye
                ? "On bye. No projection, and no points either way."
                : "Nothing projects him this week."
              : undefined
          }
        >
          {points(player.points)}
        </span>

        {showActual ? (
          <Stencil data-numeric className="block tabular-nums" title="Actually scored">
            {points(player.actual)} act
          </Stencil>
        ) : null}
      </div>
    </div>
  );
}

export function TeamWeekColumn({
  team,
  leagueId,
  /** True once the week is behind the live one. */
  played,
}: {
  team: WeekTeam;
  leagueId: string;
  played: boolean;
}) {
  const { lineup } = team;
  const marks = verdicts(lineup);
  const settled = isOptimal(lineup);

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-xs p-3",
        "bg-[color-mix(in_oklch,var(--board-deep)_40%,transparent)]",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]",
        team.isUsersTeam &&
          "bg-[color-mix(in_oklch,var(--grease)_9%,color-mix(in_oklch,var(--board-deep)_40%,transparent))]",
      )}
    >
      <header className="flex items-start gap-2.5">
        <span
          data-numeric
          className={cn(
            "stencil w-5 shrink-0 pt-1.5 text-right tabular-nums",
            team.isUsersTeam ? "text-grease" : "text-chalk-dim",
          )}
        >
          {team.rank ?? "--"}
        </span>

        <Avatar className="size-8 shrink-0 rounded-xs after:rounded-xs">
          {team.logoUrl ? <AvatarImage src={team.logoUrl} alt="" /> : null}
          <AvatarFallback className="stencil rounded-xs text-[0.625rem]">
            {initials(team.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/leagues/${leagueId}/values?team=${team.id}`}
              className="truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
            >
              {team.name}
            </Link>
            {team.isUsersTeam ? <Badge className="shrink-0">You</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {team.managerName ?? "Manager hidden"}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p
            data-numeric
            className="font-plate text-sm font-bold tabular-nums text-foreground"
            title={`Projected points from the ${lineup.current.starters.length} players currently in a starting slot.`}
          >
            {points(lineup.current.points)}
          </p>
          {settled ? (
            <Stencil className="block">Best lineup</Stencil>
          ) : (
            <Stencil
              data-numeric
              tone="grease"
              className="block tabular-nums"
              title={`The best this roster can put out is ${points(lineup.best.points)}, which is ${signedPoints(lineup.gain)} on what is slotted now.`}
            >
              {signedPoints(lineup.gain)} available
            </Stencil>
          )}
        </div>
      </header>

      {team.players.length === 0 ? (
        <EmptySeat>No players read yet</EmptySeat>
      ) : (
        <div className="flex flex-col">
          {BANDS.map((band) => {
            const held = team.players.filter((player) => player.band === band.key);
            if (held.length === 0) return null;

            return (
              <div key={band.key} className="flex flex-col">
                <div className="flex items-baseline justify-between gap-2 pt-2 pb-1">
                  <Stencil>{band.label}</Stencil>
                  {band.key === "starting" && played && lineup.current.actual !== null ? (
                    <Stencil
                      data-numeric
                      className="ml-auto tabular-nums"
                      title="What this lineup actually scored."
                    >
                      Scored {points(lineup.current.actual)}
                    </Stencil>
                  ) : null}
                  <Stencil data-numeric className="tabular-nums">
                    {held.length}
                  </Stencil>
                </div>
                <RailLine />
                {held.map((player) => (
                  <PlayerRow
                    key={player.playerId}
                    player={player}
                    leagueId={leagueId}
                    verdict={marks.get(player.playerId)}
                    showActual={played}
                  />
                ))}
              </div>
            );
          })}

          {lineup.current.unprojected > 0 ? (
            <p className="pt-2 text-xs text-muted-foreground">
              {lineup.current.unprojected === 1
                ? `1 starter has no projection this week${lineup.current.onBye === 1 ? ", and is on bye" : ""}`
                : `${lineup.current.unprojected} starters have no projection this week${lineup.current.onBye > 0 ? `, ${lineup.current.onBye} of them on bye` : ""}`}
              , so this total is short of the lineup.
            </p>
          ) : null}

          {lineup.current.empty > 0 ? (
            <p className="pt-2 text-xs text-muted-foreground">
              {lineup.current.empty} starting slot
              {lineup.current.empty === 1 ? " is" : "s are"} empty.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

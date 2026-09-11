import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { points } from "@/components/lineup/team-week-column";
import type { MatchupSide, Pairing } from "@/lib/matchups/board";
import type { MatchupPhase } from "@/lib/matchups/live";
import type { MatchupTeam } from "@/lib/matchups/store";
import { cn } from "@/lib/utils";

import { SideLineup } from "./side-lineup";
import { WinBar } from "./win-bar";

/**
 * One matchup, at full size: the two scores, the odds, and both lineups.
 *
 * This is the only screen in the app whose subject is an outcome rather than a
 * decision, and the layout says so. The figure with the most weight is what
 * each side has actually banked; the projected final sits under it in the
 * smaller type a forecast deserves; and the bar underneath is the two of them
 * argued out against how much football is left.
 *
 * The lineups are underneath rather than behind a control because the score is
 * never the answer on its own. "You are down eleven" is a fact a manager can
 * read anywhere; "you are down eleven with your flex still to play and his
 * quarterback already done" is the reason to keep watching, and it is only
 * legible with both columns on the same screen.
 */

export const PHASE_WORDS: Record<MatchupPhase, string> = {
  upcoming: "Not started",
  live: "Live",
  final: "Final",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The figure a side is read by, on both surfaces.
 *
 * Before kickoff there is nothing banked to lead with, so the forecast is the
 * only figure on the board and takes the large type for once. From the first
 * snap on it is the score, with the forecast demoted underneath it.
 *
 * Shared with the scoreboard rail, and shared with whichever side is marked as
 * leading, so the number in grease is always the number being compared.
 */
export function leadFigure(
  side: MatchupSide<MatchupTeam>,
  phase: MatchupPhase,
): number {
  return phase === "upcoming" ? side.live.projected : side.live.banked;
}

/** Which figure leads, which supports, and what each one is. */
function headline(side: MatchupSide<MatchupTeam>, phase: MatchupPhase) {
  return {
    big: leadFigure(side, phase),
    small:
      phase === "upcoming" || phase === "final"
        ? null
        : `proj ${points(side.live.projected)}`,
  };
}

function TeamHead({
  side,
  phase,
  leading,
  leagueId,
  align,
}: {
  side: MatchupSide<MatchupTeam>;
  phase: MatchupPhase;
  leading: boolean;
  leagueId: string;
  align: "left" | "right";
}) {
  const { team, live } = side;
  const { big, small } = headline(side, phase);
  const right = align === "right";

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", right && "items-end")}>
      <div
        className={cn(
          "flex min-w-0 max-w-full items-center gap-2",
          right && "flex-row-reverse",
        )}
      >
        <Avatar className="size-8 shrink-0 rounded-xs after:rounded-xs">
          {team.logoUrl ? <AvatarImage src={team.logoUrl} alt="" /> : null}
          <AvatarFallback className="stencil rounded-xs text-[0.625rem]">
            {initials(team.name)}
          </AvatarFallback>
        </Avatar>

        <div className={cn("min-w-0", right && "text-right")}>
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5",
              right && "flex-row-reverse",
            )}
          >
            <Link
              href={`/leagues/${leagueId}/values?team=${team.id}`}
              className="truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
            >
              {team.name}
            </Link>
            {team.isUsersTeam ? <Badge className="shrink-0">You</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {team.rank === null ? "Unranked" : `#${team.rank}`}
            {team.managerName ? ` · ${team.managerName}` : ""}
          </p>
        </div>
      </div>

      <div className={cn(right && "text-right")}>
        <p
          data-numeric
          className={cn(
            "font-plate text-3xl leading-none font-bold tabular-nums",
            leading ? "text-grease" : "text-foreground",
          )}
          title={
            phase === "upcoming"
              ? `Projected final from the ${live.yetToPlay} starters yet to play.`
              : live.bankedIsProviders
                ? "What the league itself has credited this side so far."
                : "Summed from this side's stat lines — the league published no running total."
          }
        >
          {points(big)}
        </p>

        {small ? (
          <Stencil
            data-numeric
            className="mt-1 block tabular-nums"
            title={
              side.providerProjected === null
                ? "What this side finishes on if everyone still to play hits his projection."
                : `What this side finishes on if everyone still to play hits his projection. The league's own projection is ${points(side.providerProjected)}.`
            }
          >
            {small}
          </Stencil>
        ) : null}
      </div>
    </div>
  );
}

/** What is still to come, said once for both sides. */
function remainingNote(pairing: Pairing<MatchupTeam>): string | null {
  const { a, b, phase } = pairing;
  if (b === null || phase === "final") return null;

  const short = a.live.unprojected + b.live.unprojected;
  const tail =
    short === 0
      ? ""
      : ` ${short === 1 ? "One starter has" : `${short} starters have`} no projection this week, so the finals above are short of ${short === 1 ? "him" : "them"}.`;

  if (phase === "upcoming") {
    return `Nobody has kicked off. ${a.live.yetToPlay} starters to play against ${b.live.yetToPlay}.${tail}`;
  }

  return `${a.live.yetToPlay} still to play against ${b.live.yetToPlay}. The odds harden as those come off the board.${tail}`;
}

export function HeadToHead({
  pairing,
  leagueId,
  label,
}: {
  pairing: Pairing<MatchupTeam>;
  leagueId: string;
  /** The panel's stencilled head — "Your matchup", or the two teams' names. */
  label: string;
}) {
  const { a, b, phase, winProbability: chance } = pairing;

  // A bye is a real week, not a missing opponent: the roster still scores, it
  // just has nothing to beat. Everything that compares two sides comes off.
  if (b === null) {
    return (
      <Panel
        label={`${label} · week ${pairing.week} · bye`}
        note="An odd number of teams leaves somebody without an opponent this week. The lineup still scores; there is nothing to score it against."
      >
        <div className="flex flex-col gap-4">
          <TeamHead
            side={a}
            phase={phase}
            leading={false}
            leagueId={leagueId}
            align="left"
          />
          <RailLine />
          <SideLineup
            side={a}
            leagueId={leagueId}
            label="Starting"
            phase={phase}
          />
        </div>
      </Panel>
    );
  }

  const note = remainingNote(pairing);

  return (
    <Panel
      label={
        <>
          {label} · week {pairing.week} ·{" "}
          <span className={cn(phase === "live" && "text-grease")}>
            {PHASE_WORDS[phase]}
          </span>
          {pairing.isPlayoffs ? " · playoffs" : ""}
        </>
      }
      note={note}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1">
            <TeamHead
              side={a}
              phase={phase}
              leading={leadFigure(a, phase) > leadFigure(b, phase)}
              leagueId={leagueId}
              align="left"
            />
          </div>

          <div className="flex shrink-0 flex-col items-center self-stretch pt-9">
            <Stencil>v</Stencil>
          </div>

          <div className="flex min-w-0 flex-1 justify-end">
            <TeamHead
              side={b}
              phase={phase}
              leading={leadFigure(b, phase) > leadFigure(a, phase)}
              leagueId={leagueId}
              align="right"
            />
          </div>
        </div>

        {chance === null ? null : (
          <WinBar
            probability={chance}
            leftLabel={a.team.isUsersTeam ? "you" : a.team.name}
            rightLabel={b.team.isUsersTeam ? "you" : b.team.name}
          />
        )}

        <RailLine />

        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <SideLineup
            side={a}
            leagueId={leagueId}
            label={a.team.name}
            phase={phase}
          />
          <SideLineup
            side={b}
            leagueId={leagueId}
            label={b.team.name}
            phase={phase}
          />
        </div>
      </div>
    </Panel>
  );
}

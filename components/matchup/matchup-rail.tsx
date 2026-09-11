import Link from "next/link";

import { Stencil } from "@/components/board/panel";
import { points } from "@/components/lineup/team-week-column";
import type { MatchupSide, Pairing } from "@/lib/matchups/board";
import type { MatchupPhase } from "@/lib/matchups/live";
import type { MatchupTeam } from "@/lib/matchups/store";
import { cn } from "@/lib/utils";

import { leadFigure, PHASE_WORDS } from "./head-to-head";
import { chanceLabel, WinBar } from "./win-bar";

/**
 * One of the rest of the league's matchups, at a glance.
 *
 * The same three facts the full panel leads with — two scores and the odds
 * between them — with the lineups left off, because the question these answer
 * is not "how is it going" but "who else is in trouble". A manager scans this
 * list for the one row that surprises him and then goes and looks at it.
 *
 * The bar is the scan. Reading eleven pairs of numbers is work; reading eleven
 * seams against a centre line is a glance, and the row a manager stops on is
 * always the one whose seam is furthest over.
 *
 * The whole row is one link, to itself at full size. That is why the team
 * names here are not links the way they are everywhere else in the app: an
 * anchor cannot contain an anchor, and on a scoreboard the useful destination
 * is the matchup rather than either roster in it. Both rosters are one click
 * further on, from the panel this opens.
 */

function Side({
  side,
  phase,
  leading,
  align,
}: {
  side: MatchupSide<MatchupTeam>;
  phase: MatchupPhase;
  leading: boolean;
  align: "left" | "right";
}) {
  const right = align === "right";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-baseline gap-2",
        right && "flex-row-reverse",
      )}
    >
      <span
        data-numeric
        className={cn(
          "stencil w-5 shrink-0 tabular-nums",
          right ? "text-left" : "text-right",
          side.team.isUsersTeam ? "text-grease" : "text-chalk-dim",
        )}
      >
        {side.team.rank ?? "--"}
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate font-plate text-sm font-semibold text-foreground",
          right && "text-right",
        )}
      >
        {side.team.name}
      </span>

      <span
        data-numeric
        className={cn(
          "shrink-0 font-plate text-sm font-bold tabular-nums",
          leading ? "text-grease" : "text-foreground",
        )}
      >
        {points(leadFigure(side, phase))}
      </span>
    </div>
  );
}

export function MatchupRail({
  pairing,
  href,
}: {
  pairing: Pairing<MatchupTeam>;
  /** This matchup at full size, at the top of the same page. */
  href: string;
}) {
  const { a, b, phase, winProbability: chance } = pairing;

  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col gap-2 rounded-xs p-3",
        "transition-colors duration-(--motion-fast) ease-(--ease-out)",
        "hover:bg-[color-mix(in_oklch,var(--channel)_38%,transparent)]",
        "bg-[color-mix(in_oklch,var(--board-deep)_40%,transparent)]",
        "shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)]",
        pairing.involvesUser &&
          "bg-[color-mix(in_oklch,var(--grease)_9%,color-mix(in_oklch,var(--board-deep)_40%,transparent))]",
      )}
    >
      <div className="flex items-baseline gap-2.5">
        <Side
          side={a}
          phase={phase}
          leading={b !== null && leadFigure(a, phase) > leadFigure(b, phase)}
          align="left"
        />

        <Stencil className="shrink-0">{b === null ? "bye" : "v"}</Stencil>

        {b === null ? (
          <div className="flex min-w-0 flex-1 items-baseline justify-end">
            <span className="stencil truncate text-chalk-dim">No opponent</span>
          </div>
        ) : (
          <Side
            side={b}
            phase={phase}
            leading={leadFigure(b, phase) > leadFigure(a, phase)}
            align="right"
          />
        )}
      </div>

      {chance === null ? null : (
        <>
          <WinBar
            slim
            probability={chance}
            leftLabel={a.team.name}
            rightLabel={b?.team.name ?? ""}
          />

          <div className="flex items-baseline justify-between gap-2">
            <Stencil data-numeric className="tabular-nums">
              {chanceLabel(chance)}
              {/* Mid-week the headline figure is the score, so the forecast
                  rides alongside the odds rather than disappearing. Before
                  kickoff the headline already *is* the forecast, and after the
                  final whistle there is nothing left to forecast.

                  Held back on a phone, where three figures and a phase across
                  one line wrap into a block that is harder to scan than the
                  two numbers it was meant to add to. The full panel a tap away
                  carries it either way. */}
              {phase === "live" ? (
                <span className="hidden sm:inline">
                  {` · proj ${points(a.live.projected)}`}
                </span>
              ) : null}
            </Stencil>

            <Stencil className={cn(phase === "live" && "text-grease")}>
              {PHASE_WORDS[phase]}
              {phase === "final"
                ? ""
                : ` · ${a.live.yetToPlay}v${b === null ? 0 : b.live.yetToPlay} to play`}
            </Stencil>

            <Stencil data-numeric className="tabular-nums">
              {phase === "live" && b ? (
                <span className="hidden sm:inline">
                  {`proj ${points(b.live.projected)} · `}
                </span>
              ) : null}
              {chanceLabel(1 - chance)}
            </Stencil>
          </div>
        </>
      )}
    </Link>
  );
}

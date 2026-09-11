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
 */

function Side({
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

      <Link
        href={`/leagues/${leagueId}/values?team=${side.team.id}`}
        className={cn(
          "min-w-0 flex-1 truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline",
          right && "text-right",
        )}
      >
        {side.team.name}
      </Link>

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
  leagueId,
}: {
  pairing: Pairing<MatchupTeam>;
  leagueId: string;
}) {
  const { a, b, phase, winProbability: chance } = pairing;

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-xs p-3",
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
          leagueId={leagueId}
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
            leagueId={leagueId}
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
            </Stencil>

            <Stencil className={cn(phase === "live" && "text-grease")}>
              {PHASE_WORDS[phase]}
              {phase === "final"
                ? ""
                : ` · ${a.live.yetToPlay}v${b === null ? 0 : b.live.yetToPlay} to play`}
            </Stencil>

            <Stencil data-numeric className="tabular-nums">
              {chanceLabel(1 - chance)}
            </Stencil>
          </div>
        </>
      )}
    </section>
  );
}

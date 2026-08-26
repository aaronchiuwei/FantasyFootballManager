"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";

import { PlayerHeadshot } from "@/components/players/headshot";
import { InjuryBadge } from "@/components/players/injury-badge";
import { NeedChip } from "@/components/needs/need-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { NEED_POSITIONS } from "@/lib/needs/needs";
import {
  DEFAULT_LAMBDA,
  LAMBDA_LIMITS,
  rankWaivers,
  type WaiverPick,
} from "@/lib/waivers/score";
import type { WaiverBoard as Board, WaiverPlayer } from "@/lib/waivers/store";
import { cn } from "@/lib/utils";
import { saveNeedWeightAction } from "@/app/(app)/leagues/[id]/waivers/actions";

/** One screenful of recommendations; the rest is what the filters are for. */
const PAGE_SIZE = 40;

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
        "chip",
        active ? "chip-on" : "chip-off",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Requirement 7, as §7 answers it: the wire ranked on rest-of-season
 * projection, tilted toward the positions this team is thin at.
 *
 * ```
 * score = ros_projected_points(p) × (1 + λ × need(position(p)))
 * ```
 *
 * Everything on this screen is already in memory — the page handed over the
 * whole available pool and the league's needs vector in one read — so changing
 * the team, the position filter or λ re-ranks the board in the same tick, with
 * no server in the loop. The server is asked for one thing: persist λ.
 */
export function WaiverBoard({
  leagueId,
  board,
}: {
  leagueId: string;
  board: Board;
}) {
  const [teamId, setTeamId] = useState(
    () => (board.teams.find((team) => team.isUsersTeam) ?? board.teams[0])?.id ?? "",
  );
  const [position, setPosition] = useState<string | null>(null);
  const [lambda, setLambda] = useState(board.lambda);

  const team = board.teams.find((entry) => entry.id === teamId) ?? null;

  const needs = useMemo(
    () => new Map(Object.entries(team?.needs ?? {})),
    [team],
  );

  const picks = useMemo(() => {
    const pool = position
      ? board.players.filter((player) => player.position === position)
      : board.players;

    return rankWaivers(pool, needs, lambda);
  }, [board.players, needs, position, lambda]);

  function commitLambda(next: number) {
    setLambda(next);
    void saveNeedWeightAction(leagueId, next).then(({ error }) => {
      if (error) toast.error(error);
    });
  }

  const shown = picks.slice(0, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-3">
        <CardContent className="space-y-3 px-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <label
                htmlFor="waiver-team"
                className="stencil text-chalk-dim"
              >
                Recommending for
              </label>
              <select
                id="waiver-team"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                className="h-8 w-full max-w-[16rem] min-w-0 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] px-2 font-plate text-sm text-foreground shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {board.teams.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.isUsersTeam ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                Object.entries(team?.needs ?? {}) as [string, number][]
              )
                .filter(([, need]) => need > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([entry, need]) => (
                  <NeedChip
                    key={entry}
                    position={entry}
                    z={need}
                    kind="need"
                  />
                ))}
            </div>
          </div>

          <div className="space-y-1.5 border-t pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="waiver-lambda" className="text-sm font-medium">
                <span className="font-mono text-muted-foreground">λ</span> Need
                weight
              </label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm tabular-nums">
                  {lambda.toFixed(2)}
                </span>
                {lambda !== DEFAULT_LAMBDA ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={() => commitLambda(DEFAULT_LAMBDA)}
                  >
                    <RotateCcw className="size-3" aria-hidden />
                    Default
                  </Button>
                ) : null}
              </div>
            </div>

            <Slider
              id="waiver-lambda"
              min={LAMBDA_LIMITS.min}
              max={LAMBDA_LIMITS.max}
              step={LAMBDA_LIMITS.step}
              value={[lambda]}
              onValueChange={([next]) => setLambda(next)}
              onValueCommit={([next]) => commitLambda(next)}
            />

            <p className="text-xs text-muted-foreground">
              {lambda === 0
                ? "Off. The board is pure rest-of-season projection, which is the ranking §7 argues for on its own."
                : `A position one standard deviation thin is worth ${(1 + lambda).toFixed(2)}× its projection here; one that deep, ${(1 - lambda).toFixed(2)}×.`}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-1.5">
        <Filter active={position === null} onClick={() => setPosition(null)}>
          All
        </Filter>
        {NEED_POSITIONS.map((entry) => (
          <Filter
            key={entry}
            active={position === entry}
            onClick={() => setPosition(entry)}
          >
            {entry}
          </Filter>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing available at that position.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="thead-rail stencil text-chalk-dim">
                <th className="w-10 py-2 pr-3 text-right font-semibold">#</th>
                <th className="w-12 py-2 pr-3 text-left font-semibold">Pos</th>
                <th className="py-2 pr-3 text-left font-semibold">Player</th>
                <th className="py-2 pr-3 text-right font-semibold">ROS</th>
                <th className="hidden py-2 pr-3 text-right font-semibold sm:table-cell">
                  Need
                </th>
                <th className="py-2 pr-3 text-right font-semibold">Score</th>
                <th className="hidden py-2 pr-3 text-right font-semibold md:table-cell">
                  Value
                </th>
                <th className="py-2 text-right font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((pick, index) => (
                <Row
                  key={pick.candidate.playerId}
                  rank={index + 1}
                  pick={pick}
                  leagueId={leagueId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picks.length > PAGE_SIZE ? (
        <p className="text-center text-xs text-muted-foreground">
          Showing the top {PAGE_SIZE} of {picks.length.toLocaleString()}. Filter
          by position to see further down the wire.
        </p>
      ) : null}
    </div>
  );
}

function Row({
  rank,
  pick,
  leagueId,
}: {
  rank: number;
  pick: WaiverPick<WaiverPlayer>;
  leagueId: string;
}) {
  const { candidate, multiplier } = pick;
  const moved = Math.abs(multiplier - 1) > 0.005;

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 text-right font-mono text-xs text-muted-foreground">
        {rank}
      </td>

      <td className="py-2 pr-3">
        <PositionBadge position={candidate.position} />
      </td>

      <td className="py-2 pr-3">
        <div className="flex items-center gap-2.5">
          <PlayerHeadshot
            src={candidate.headshotUrl}
            name={candidate.name}
            size="md"
          />

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/leagues/${leagueId}/players/${candidate.playerId}`}
                className="truncate font-medium underline-offset-4 hover:underline"
              >
                {candidate.name}
              </Link>
              <InjuryBadge
                status={candidate.injuryStatus}
                note={candidate.injuryNote}
              />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {candidate.nflTeam ?? "FA"}
            </p>
          </div>
        </div>
      </td>

      <td className="py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
        {candidate.rosPoints === null ? "--" : candidate.rosPoints.toFixed(1)}
      </td>

      <td
        className={cn(
          "hidden py-2 pr-3 text-right font-mono text-xs tabular-nums sm:table-cell",
          !moved && "text-muted-foreground",
          moved && multiplier > 1 && "text-success",
          moved && multiplier < 1 && "text-muted-foreground",
        )}
      >
        ×{multiplier.toFixed(2)}
      </td>

      <td className="py-2 pr-3 text-right font-mono text-sm font-medium tabular-nums">
        {pick.score.toFixed(1)}
      </td>

      <td className="hidden py-2 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground md:table-cell">
        {candidate.value.toLocaleString()}
      </td>

      <td className="py-2 text-right">
        <ValueBadge source={candidate.source} />
      </td>
    </tr>
  );
}

import {
  formatStat,
  projectionDelta,
  statColumnsFor,
  type SeasonLines,
} from "@/lib/players/stat-lines";
import type { SosTier, WeekMatchup } from "@/lib/schedule/sos";
import { cn } from "@/lib/utils";

/**
 * The opponent a week was played against, tinted by what that defense gives
 * up to the position. Colour is the second carrier, as everywhere else: the
 * cell always prints the opponent, and the grade behind the tint is spelled
 * out on hover.
 */
const TIER_INK: Record<SosTier, string> = {
  easy: "text-success",
  even: "text-muted-foreground",
  hard: "text-warning",
};

function OpponentCell({
  matchup,
  position,
}: {
  matchup: WeekMatchup | undefined;
  position: string | null;
}) {
  // No matchup at all is the prior season, where the schedule is known but the
  // team this player was on that week is not. A blank is the honest answer;
  // an opponent read off today's roster would be a guess wearing a fact's
  // clothes, which is exactly what the defense grades go outside for.
  if (!matchup || matchup.opponent === null) {
    return <span className="text-muted-foreground">--</span>;
  }

  const grade =
    matchup.tier === null || matchup.pointsPerGame === null
      ? `${matchup.opponent} is not graded at this position.`
      : `${matchup.opponent} is the ${matchup.opponentRank} softest defense of ${matchup.outOf} against a ${position ?? "player"}, giving up ${matchup.pointsPerGame >= 0 ? "+" : "-"}${Math.abs(matchup.pointsPerGame).toFixed(1)} points a game against the average defense.`;

  return (
    <span
      title={grade}
      className={cn(
        "font-plate font-semibold",
        matchup.tier === null ? "text-muted-foreground" : TIER_INK[matchup.tier],
      )}
    >
      {matchup.isHome ? "" : "@"}
      {matchup.opponent}
    </span>
  );
}

/**
 * The game log: one row per week, projection against actual, with the handful
 * of box-score numbers that make the line legible for the position.
 *
 * Which side each row's stat columns come from is the point of the whole
 * screen. A week that has been played shows what happened; a week ahead shows
 * what is expected, greyed, so the two are never mistaken for each other at a
 * glance. Before kickoff every row is the second kind — which is honest, and
 * is why the column is labelled rather than left to be inferred.
 */
export function WeekLineTable({
  lines,
  position,
  matchups,
}: {
  lines: SeasonLines;
  position: string | null;
  /**
   * Who each week is against, keyed by week. Absent for a season whose
   * schedule has not been read, and deliberately absent for the prior one.
   */
  matchups?: Map<number, WeekMatchup>;
}) {
  const columns = statColumnsFor(position);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="thead-rail stencil text-chalk-dim">
            <th className="w-12 py-2 pr-3 text-left font-semibold">Wk</th>
            {matchups ? (
              <th className="w-16 py-2 pr-3 text-left font-semibold">Opp</th>
            ) : null}
            <th className="w-16 py-2 pr-3 text-right font-semibold">Proj</th>
            <th className="w-16 py-2 pr-3 text-right font-semibold">Actual</th>
            <th className="hidden w-16 py-2 pr-3 text-right font-semibold sm:table-cell">
              Δ
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                className="hidden py-2 pr-3 text-right font-semibold md:table-cell"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {lines.weeks.map((week) => {
            const played = week.actual !== null;
            const delta = projectionDelta(week);
            const stats = played ? week.actualStats : week.projectedStats;

            return (
              <tr key={week.week} className="border-b last:border-0">
                <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">
                  {week.week}
                </td>

                {matchups ? (
                  <td className="py-2 pr-3 text-left text-xs">
                    <OpponentCell
                      matchup={matchups.get(week.week)}
                      position={position}
                    />
                  </td>
                ) : null}

                <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                  {week.projected === null ? "--" : week.projected.toFixed(1)}
                </td>

                <td
                  className={cn(
                    "py-2 pr-3 text-right font-mono tabular-nums",
                    played ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {played ? week.actual!.toFixed(1) : "--"}
                </td>

                <td className="hidden py-2 pr-3 text-right font-mono text-xs sm:table-cell">
                  {delta === null ? (
                    <span className="text-muted-foreground">--</span>
                  ) : (
                    <span
                      className={cn(
                        delta >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {delta >= 0 ? "+" : "-"}
                      {Math.abs(Math.round(delta * 100))}%
                    </span>
                  )}
                </td>

                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "hidden py-2 pr-3 text-right font-mono tabular-nums md:table-cell",
                      played ? "" : "text-muted-foreground",
                    )}
                  >
                    {formatStat(stats, column)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

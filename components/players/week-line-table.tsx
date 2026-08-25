import {
  formatStat,
  projectionDelta,
  statColumnsFor,
  type SeasonLines,
} from "@/lib/players/stat-lines";
import { cn } from "@/lib/utils";

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
export function WeekLineTable({ lines, position }: { lines: SeasonLines; position: string | null }) {
  const columns = statColumnsFor(position);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="w-12 py-2 pr-3 text-left font-medium">Wk</th>
            <th className="w-16 py-2 pr-3 text-right font-medium">Proj</th>
            <th className="w-16 py-2 pr-3 text-right font-medium">Actual</th>
            <th className="hidden w-16 py-2 pr-3 text-right font-medium sm:table-cell">
              Δ
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                className="hidden py-2 pr-3 text-right font-medium md:table-cell"
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

                <td className="py-2 pr-3 text-right font-mono tabular-nums text-muted-foreground">
                  {week.projected === null ? "—" : week.projected.toFixed(1)}
                </td>

                <td
                  className={cn(
                    "py-2 pr-3 text-right font-mono tabular-nums",
                    played ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {played ? week.actual!.toFixed(1) : "—"}
                </td>

                <td className="hidden py-2 pr-3 text-right font-mono text-xs sm:table-cell">
                  {delta === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span
                      className={cn(
                        delta >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {delta >= 0 ? "+" : "−"}
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

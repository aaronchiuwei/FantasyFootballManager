import Link from "next/link";

import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import type { Database } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type ValueRowData =
  Database["public"]["Views"]["league_player_values"]["Row"];

function trend(value: number | null) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={cn("font-mono text-xs", up ? "text-success" : "text-destructive")}>
      {up ? "▲" : "▼"}
      {Math.abs(Math.round(value)).toLocaleString()}
    </span>
  );
}

export function PlayerValueRow({
  row,
  leagueId,
}: {
  row: ValueRowData;
  leagueId: string;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 text-right font-mono text-xs text-muted-foreground">
        {row.overall_rank ?? "—"}
      </td>

      <td className="py-2 pr-3">
        <PositionBadge position={row.position} />
      </td>

      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
          {/* The way into the stats surface of Requirement 4. */}
          <Link
            href={`/leagues/${leagueId}/players/${row.player_id}`}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {row.full_name}
          </Link>
          <InjuryBadge status={row.injury_status} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {row.nfl_team ?? "FA"}
          {row.position_rank ? ` · ${row.position}${row.position_rank}` : ""}
        </p>
      </td>

      <td className="hidden py-2 pr-3 sm:table-cell">
        <p className="truncate text-sm">
          {row.team_name ?? (
            <span className="text-muted-foreground">Free agent</span>
          )}
        </p>
        {row.slot ? (
          <p className="truncate text-xs text-muted-foreground">{row.slot}</p>
        ) : null}
      </td>

      <td className="hidden py-2 pr-3 text-right font-mono text-sm text-muted-foreground md:table-cell">
        {row.projected_pts_ppr === null
          ? "—"
          : Number(row.projected_pts_ppr).toFixed(1)}
      </td>

      <td className="py-2 pr-3 text-right">
        <span className="font-mono text-sm font-medium tabular-nums">
          {row.value.toLocaleString()}
        </span>
        <div className="leading-none">{trend(row.trend_30d)}</div>
      </td>

      <td className="py-2 text-right">
        <ValueBadge source={row.value_source} />
      </td>
    </tr>
  );
}

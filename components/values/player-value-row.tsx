import Link from "next/link";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

import { PlayerHeadshot } from "@/components/players/headshot";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import type { Database } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

export type ValueRowData =
  Database["public"]["Views"]["league_player_values"]["Row"];

/**
 * The 30-day move. A drawn arrow from the icon set rather than a unicode
 * triangle: every mark in this app comes from one icon family at one weight,
 * and a glyph borrowed from the text stream is not an icon.
 */
function Trend({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  const Icon = up ? ArrowUpIcon : ArrowDownIcon;

  return (
    <span
      data-numeric
      className={cn(
        "stencil inline-flex items-center gap-0.5 tabular-nums",
        up ? "text-success" : "text-destructive",
      )}
    >
      <Icon className="size-2.5" aria-hidden />
      {Math.abs(Math.round(value)).toLocaleString()}
    </span>
  );
}

/**
 * A row of the values board. The row is the plate seen edge on: the same
 * position core at its head, the same engraved name, the same stamped figure
 * at its trailing edge, laid flat into a table so two hundred of them can be
 * scanned in one column.
 */
export function PlayerValueRow({
  row,
  leagueId,
}: {
  row: ValueRowData;
  leagueId: string;
}) {
  return (
    <tr className="group/row transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-[color-mix(in_oklch,var(--channel)_38%,transparent)]">
      <td
        data-numeric
        className="stencil py-2.5 pr-3 text-right tabular-nums text-chalk-dim"
      >
        {row.overall_rank ?? "--"}
      </td>

      <td className="py-2.5 pr-3">
        <PositionBadge position={row.position} />
      </td>

      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2.5">
          <PlayerHeadshot
            src={row.headshot_url}
            name={row.full_name}
            size="md"
          />

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* The way into the player's stats surface. */}
              <Link
                href={`/leagues/${leagueId}/players/${row.player_id}`}
                className="truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
              >
                {row.full_name}
              </Link>
              <InjuryBadge status={row.injury_status} note={row.injury_note} />
            </div>
            <p className="stencil mt-0.5 truncate text-chalk-dim">
              {row.nfl_team ?? "FA"}
              {row.position_rank ? ` · ${row.position}${row.position_rank}` : ""}
            </p>
          </div>
        </div>
      </td>

      <td className="hidden py-2.5 pr-3 sm:table-cell">
        <p className="truncate text-sm text-foreground">
          {row.team_name ?? (
            <span className="text-muted-foreground">Free agent</span>
          )}
        </p>
        {row.slot ? (
          <p className="stencil mt-0.5 truncate text-chalk-dim">{row.slot}</p>
        ) : null}
      </td>

      <td
        data-numeric
        className="hidden py-2.5 pr-3 text-right font-plate text-sm tabular-nums text-muted-foreground md:table-cell"
      >
        {row.projected_pts_ppr === null
          ? "--"
          : Number(row.projected_pts_ppr).toFixed(1)}
      </td>

      <td className="py-2.5 pr-3 text-right">
        <span
          data-numeric
          className="font-plate text-sm font-bold tabular-nums text-foreground"
        >
          {row.value.toLocaleString()}
        </span>
        <div className="leading-none">
          <Trend value={row.trend_30d} />
        </div>
      </td>

      <td className="py-2.5 text-right">
        <ValueBadge source={row.value_source} />
      </td>
    </tr>
  );
}

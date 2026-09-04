import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Stencil } from "@/components/board/panel";
import { EmptySeat, RailLine } from "@/components/board/rail";
import { InjuryBadge } from "@/components/players/injury-badge";
import { PositionBadge } from "@/components/values/position-badge";
import type { RosterBand, RosterPlayer, TeamRoster } from "@/lib/leagues/rosters";
import { cn } from "@/lib/utils";

/** Everything a roster column needs to name the team holding it. */
export type RosterTeam = {
  id: string;
  name: string;
  managerName: string | null;
  logoUrl: string | null;
  isUsersTeam: boolean;
  rank: number | null;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The bands `loadLeagueRosters` sorts into, named on the board so the order is
 * readable rather than inferred. A band with nobody in it is not drawn: a
 * league with no IR slot should not grow an empty heading.
 */
const BANDS: { key: RosterBand; label: string }[] = [
  { key: "starting", label: "Starting" },
  { key: "bench", label: "Bench" },
  { key: "reserve", label: "Reserve" },
];

/** One player on the board: position core, engraved name, stamped figure. */
function RosterRow({
  player,
  leagueId,
}: {
  player: RosterPlayer;
  leagueId: string;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <PositionBadge position={player.position} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/* Straight to the player's season and week-by-week stats, the same
              door the values board opens. */}
          <Link
            href={`/leagues/${leagueId}/players/${player.playerId}`}
            className="truncate font-plate text-sm font-semibold text-foreground underline-offset-4 hover:underline"
          >
            {player.name}
          </Link>
          <InjuryBadge status={player.injuryStatus} />
        </div>
        <p className="stencil truncate text-chalk-dim">
          {player.nflTeam ?? "FA"}
          {player.slot ? ` · ${player.slot}` : ""}
        </p>
      </div>

      <span
        data-numeric
        className={cn(
          "shrink-0 font-plate text-sm tabular-nums",
          player.value === null ? "text-chalk-dim" : "text-foreground",
        )}
        title={player.value === null ? "Not priced yet" : undefined}
      >
        {player.value === null ? "--" : Math.round(player.value).toLocaleString()}
      </span>
    </div>
  );
}

/**
 * One team's whole roster, as a column of the board.
 *
 * A roster is a list of players, so every row is a plate's worth of
 * information laid flat: the cut-through position field, the engraved name,
 * the stamped value. The team above it is not a player, so it is not bone --
 * it is a recessed head on the board, the same one the league page stamps a
 * team with.
 *
 * The whole thing is server-rendered and every player is a link, so the
 * section is readable and navigable with no JavaScript at all, which is what
 * a reference list of two hundred names should be.
 */
export function TeamRosterColumn({
  team,
  roster,
  leagueId,
}: {
  team: RosterTeam;
  /** Absent when the roster has not been read yet, which the column says. */
  roster: TeamRoster | undefined;
  leagueId: string;
}) {
  const players = roster?.players ?? [];

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
            {/* The same roster as a filtered, ranked values board, for when the
                question turns from "who do they have" into "what is he worth". */}
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
          >
            {roster?.value === null || roster === undefined
              ? "--"
              : Math.round(roster.value).toLocaleString()}
          </p>
          <Stencil className="block">
            {players.length} player{players.length === 1 ? "" : "s"}
          </Stencil>
        </div>
      </header>

      {players.length === 0 ? (
        <EmptySeat>No players read yet</EmptySeat>
      ) : (
        <div className="flex flex-col">
          {BANDS.map((band) => {
            const held = players.filter((player) => player.band === band.key);
            if (held.length === 0) return null;

            return (
              <div key={band.key} className="flex flex-col">
                <div className="flex items-baseline justify-between gap-2 pt-2 pb-1">
                  <Stencil>{band.label}</Stencil>
                  <Stencil data-numeric className="tabular-nums">
                    {held.length}
                  </Stencil>
                </div>
                <RailLine />
                {held.map((player) => (
                  <RosterRow
                    key={player.playerId}
                    player={player}
                    leagueId={leagueId}
                  />
                ))}
              </div>
            );
          })}

          {roster && roster.unpriced > 0 ? (
            <p className="pt-2 text-xs text-muted-foreground">
              {roster.unpriced} of them {roster.unpriced === 1 ? "has" : "have"}{" "}
              no price yet, so this total is short of the roster.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

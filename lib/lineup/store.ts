import "server-only";

import { isManualLeague } from "@/lib/leagues/manual";
import { loadLeagueRosters, type RosterBand } from "@/lib/leagues/rosters";
import { loadCoverage } from "@/lib/players/stats";
import { weekWindow } from "@/lib/schedule/sos";
import { scoredPoints, type StatLine } from "@/lib/sources/sleeper-parse";
import type { RosterSlot } from "@/lib/sources/yahoo";
import type { Db } from "@/lib/supabase/db";
import type { StartingSlot } from "@/lib/values/vor";

import { BENCH, isReserveSlot, resolveLineup } from "./assign";
import { weekLineup, type WeekLineup, type WeekPlayer } from "./weekly";

/**
 * The start/sit board's one read.
 *
 * Nothing here is computed for the week ahead of time and nothing is cached,
 * which is the opposite of how §7's needs vector and §9's suggestion engines
 * work — and deliberately so. Those fold the whole league into a structure
 * that costs a stage to build; this is a join of two tables the sync already
 * wrote, over one week, for one league's two hundred rostered players. Caching
 * it would buy a few milliseconds and cost the thing the screen is for: a
 * lineup decision that has to be right on Sunday morning, not right as of the
 * last sync.
 *
 * Takes a `Db` rather than making one, like every other data-access module.
 */

/** A rostered player for one week, carrying what the board draws him with. */
export type WeekRosterPlayer = WeekPlayer & {
  band: RosterBand;
  /** This league's own trade value, for continuity with every other screen. */
  value: number | null;
};

export type WeekTeam = {
  id: string;
  name: string;
  managerName: string | null;
  logoUrl: string | null;
  isUsersTeam: boolean;
  rank: number | null;
  players: WeekRosterPlayer[];
  lineup: WeekLineup<WeekRosterPlayer>;
};

export type WeekBoard = {
  season: number;
  week: number;
  /** Every week this league plays, which is the picker's whole range. */
  weeks: number[];
  /** The live NFL week, where the season clock knows one. */
  currentWeek: number | null;
  /** True once the week is behind the live one, so actuals are the real story. */
  isPlayed: boolean;
  teams: WeekTeam[];
  /** The league's own starting slots, so the board can name what it solved against. */
  rosterSlots: StartingSlot[];
  /**
   * When this week's projection grid was pulled, and how many lines landed.
   * Null means it has never been pulled, which is a different statement from a
   * player having no line in it, and the two must not render the same way.
   */
  projectedAt: string | null;
  projectedLines: number;
  /** False when the NFL slate for this week has not been synced, so byes are unknown. */
  hasSlate: boolean;
};

/**
 * One week of one of the two mirrored stat tables, scored for this league.
 *
 * Scoring is re-applied on read rather than trusted from the stored `pts_ppr`,
 * for §1.2's reason: one row is shared by every league in the app, and the
 * league's own PPR modifier decides what it is worth.
 */
async function readWeek(
  db: Db,
  table: "player_stats" | "player_projections",
  {
    season,
    week,
    playerIds,
    ppr,
  }: { season: number; week: number; playerIds: number[]; ppr: number },
): Promise<Map<number, number | null>> {
  const lines = new Map<number, number | null>();
  if (playerIds.length === 0) return lines;

  const { data, error } = await db
    .from(table)
    .select("player_id, stats, pts_ppr")
    .eq("season", season)
    .eq("week", week)
    .in("player_id", playerIds);

  // A stat table that cannot be read costs the board its figures, not its
  // rosters. Every surface in this app would rather print "--" than refuse.
  if (error) return lines;

  for (const row of data ?? []) {
    const line: StatLine = {
      sleeperId: "",
      ptsPpr: row.pts_ppr,
      stats: (row.stats ?? {}) as Record<string, number>,
    };
    lines.set(row.player_id, scoredPoints(line, ppr));
  }

  return lines;
}

/**
 * The stored lineups for one week, by team.
 *
 * A team with no rows is absent from the map rather than present and empty,
 * because those are different states: one is a week nobody has set and the
 * other cannot happen — a lineup somebody set has somebody in it.
 */
async function readWeekLineups(
  db: Db,
  { teamIds, week }: { teamIds: string[]; week: number },
): Promise<Map<string, Map<number, string>>> {
  const byTeam = new Map<string, Map<number, string>>();
  if (teamIds.length === 0) return byTeam;

  const { data, error } = await db
    .from("lineups")
    .select("team_id, player_id, slot")
    .in("team_id", teamIds)
    .eq("week", week);

  // A lineup table that cannot be read costs the board its overrides, not its
  // rosters: every week falls back to the best lineup, which is what an unset
  // week resolves to anyway.
  if (error) return byTeam;

  for (const row of data ?? []) {
    const team = byTeam.get(row.team_id) ?? new Map<number, string>();
    team.set(row.player_id, row.slot);
    byTeam.set(row.team_id, team);
  }

  return byTeam;
}

/** Who each NFL team plays in one week. A bye is the absence of a row. */
async function readSlate(
  db: Db,
  { season, week }: { season: number; week: number },
): Promise<Map<string, { opponent: string; isHome: boolean }>> {
  const slate = new Map<string, { opponent: string; isHome: boolean }>();

  const { data, error } = await db
    .from("nfl_schedule")
    .select("team, opponent, is_home")
    .eq("season", season)
    .eq("week", week);

  if (error) return slate;

  for (const row of data ?? []) {
    slate.set(row.team, { opponent: row.opponent, isHome: row.is_home });
  }

  return slate;
}

export type WeekLeague = {
  id: string;
  season: number;
  ppr: number;
  rosterSlots: StartingSlot[];
  currentWeek: number | null;
  startWeek: number | null;
  endWeek: number | null;
  /** Whose lineup it is: ours to resolve, or the provider's to state. */
  isManual: boolean;
};

/**
 * The weeks a league actually plays, which is the window the projection grid
 * was pulled over (`scheduleWeeks` in `lib/sync/clock.ts`) and therefore the
 * only window this board can say anything about.
 */
export function leagueWeeks(league: {
  startWeek: number | null;
  endWeek: number | null;
}): number[] {
  return weekWindow(league.startWeek ?? 1, league.endWeek ?? 17);
}

/**
 * Which week the board opens on, and which one a query string may move it to.
 *
 * The live week is the default because it is the decision in front of the
 * manager. Before kickoff there is no live week and the first week of the
 * league's own window is the honest answer — not week one, which a league
 * starting late never plays.
 */
export function resolveWeek(
  league: { currentWeek: number | null; startWeek: number | null; endWeek: number | null },
  requested: string | number | null | undefined,
): number {
  const weeks = leagueWeeks(league);
  const fallback =
    league.currentWeek !== null && weeks.includes(league.currentWeek)
      ? league.currentWeek
      : weeks[0];

  const asked =
    typeof requested === "number" ? requested : Number.parseInt(requested ?? "", 10);

  return Number.isInteger(asked) && weeks.includes(asked) ? asked : fallback;
}

/** The league row every caller of `loadWeekBoard` needs, in the shape it wants. */
export function toWeekLeague(row: {
  id: string;
  season: number;
  ppr: number | string;
  roster_slots: unknown;
  current_week: number | null;
  start_week: number | null;
  end_week: number | null;
  source: string | null;
}): WeekLeague {
  return {
    id: row.id,
    season: row.season,
    ppr: Number(row.ppr),
    rosterSlots: (row.roster_slots ?? []) as unknown as RosterSlot[],
    currentWeek: row.current_week,
    startWeek: row.start_week,
    endWeek: row.end_week,
    isManual: isManualLeague(row.source),
  };
}

/**
 * Every roster in a league, read for one week and solved against the league's
 * own starting slots.
 *
 * Five reads and no writes. The rosters come from `loadLeagueRosters` rather
 * than from `league_player_values`, for the reason that module states: the
 * view is inner-joined to `player_values`, so a player nothing has priced yet
 * is missing from it — and this screen is about who is startable, which is
 * true long before anyone has a price.
 */
export async function loadWeekBoard(
  db: Db,
  { league, week }: { league: WeekLeague; week: number },
): Promise<WeekBoard> {
  const [{ data: teams, error: teamError }, rosters] = await Promise.all([
    db
      .from("teams")
      .select("id, name, manager_name, logo_url, is_users_team, rank")
      .eq("league_id", league.id)
      .order("rank", { ascending: true, nullsFirst: false }),
    loadLeagueRosters(db, league.id),
  ]);

  if (teamError) throw new Error(`Failed to read teams: ${teamError.message}`);

  const playerIds = [
    ...new Set(
      [...rosters.values()].flatMap((roster) =>
        roster.players.map((player) => player.playerId),
      ),
    ),
  ];

  const [projections, actuals, slate, coverage, stored] = await Promise.all([
    readWeek(db, "player_projections", {
      season: league.season,
      week,
      playerIds,
      ppr: league.ppr,
    }),
    readWeek(db, "player_stats", {
      season: league.season,
      week,
      playerIds,
      ppr: league.ppr,
    }),
    readSlate(db, { season: league.season, week }),
    loadCoverage(db, [league.season]),
    readWeekLineups(db, { teamIds: (teams ?? []).map((team) => team.id), week }),
  ]);

  const pulled = coverage.get(`${league.season}:projected:${week}`) ?? null;

  const built: WeekTeam[] = (teams ?? []).map((team) => {
    const players: WeekRosterPlayer[] = (rosters.get(team.id)?.players ?? []).map(
      (player) => {
        const game = player.nflTeam ? slate.get(player.nflTeam) : undefined;

        return {
          playerId: player.playerId,
          name: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          injuryStatus: player.injuryStatus,
          headshotUrl: player.headshotUrl,
          slot: player.slot,
          isStarter: player.isStarter,
          band: player.band,
          value: player.value,
          points: projections.get(player.playerId) ?? null,
          actual: actuals.get(player.playerId) ?? null,
          opponent: game?.opponent ?? null,
          isHome: game?.isHome ?? false,
          // Only a slate we have can put a player on bye. Without one the
          // whole league would read as rested, which is a claim nobody made.
          onBye: slate.size > 0 && player.nflTeam !== null && game === undefined,
        };
      },
    );

    // The week's lineup, resolved. An unset week on a hand-kept league is the
    // best lineup the roster could field rather than eleven empty seats, and
    // an unset week on an imported one is whatever the provider last said —
    // guessing a better lineup for a league whose lineup we do not own would
    // be overruling it.
    const seats = resolveLineup(
      players,
      league.rosterSlots,
      stored.get(team.id) ?? new Map(),
      league.isManual ? "best" : "keep",
    );

    for (const player of players) {
      const slot = seats.get(player.playerId) ?? BENCH;
      player.slot = slot;
      player.isStarter = !isReserveSlot(slot) && slot !== BENCH;
      // The band is re-read from the week too. It groups the column into
      // starting, bench and reserve, and a band left over from the roster's
      // own arrangement would print a heading that disagreed with the seats
      // underneath it.
      player.band = player.isStarter
        ? "starting"
        : isReserveSlot(slot)
          ? "reserve"
          : "bench";
    }

    return {
      id: team.id,
      name: team.name,
      managerName: team.manager_name,
      logoUrl: team.logo_url,
      isUsersTeam: team.is_users_team,
      rank: team.rank,
      players,
      lineup: weekLineup(players, league.rosterSlots),
    };
  });

  return {
    season: league.season,
    week,
    weeks: leagueWeeks(league),
    currentWeek: league.currentWeek,
    isPlayed: league.currentWeek !== null && week < league.currentWeek,
    teams: built,
    rosterSlots: league.rosterSlots,
    projectedAt: pulled?.fetchedAt ?? null,
    projectedLines: pulled?.players ?? 0,
    hasSlate: slate.size > 0,
  };
}

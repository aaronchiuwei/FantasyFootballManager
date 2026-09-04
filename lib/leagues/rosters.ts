import "server-only";

import type { Db } from "@/lib/supabase/db";

/**
 * Every roster in a league, read whole.
 *
 * Deliberately sourced from `rosters` joined to the player master rather than
 * from `league_player_values`: the view is inner-joined to `player_values`, so
 * a player the engine has not priced yet has no row in it. That is the right
 * shape for a values board, where an unpriced player is nothing to show, and
 * the wrong shape here. This surface answers "who does this team have", which
 * is true the moment the roster stage commits and long before stage 8 runs.
 * A missing price prints as no price; a missing player would be a lie.
 *
 * Values ride along from `player_values` in a second read, keyed to the ids
 * this one found, so the price a plate carries is the same number the values
 * board and the trade analyzer are arguing with.
 */

/**
 * The three bands a roster is read in, in the order a manager reads their own
 * team: the lineup, the bench behind it, then whoever is stashed on reserve.
 */
export type RosterBand = "starting" | "bench" | "reserve";

export type RosterPlayer = {
  playerId: number;
  name: string;
  position: string | null;
  nflTeam: string | null;
  injuryStatus: string | null;
  headshotUrl: string | null;
  /** The provider's roster slot ("QB", "W/R/T", "BN", "IR"), where there is one. */
  slot: string | null;
  isStarter: boolean;
  /** Null when nothing has priced them yet, which is not the same as zero. */
  value: number | null;
  valueSource: string | null;
  band: RosterBand;
};

export type TeamRoster = {
  teamId: string;
  players: RosterPlayer[];
  /** Players in a starting slot, so the bench rule below can be stated. */
  starters: number;
  /** Summed value of the whole roster. Null when nobody on it is priced. */
  value: number | null;
  /** Rostered players carrying no price, so the sum understates them. */
  unpriced: number;
};

/** The order a roster is read in, matching the manual league's roster editor. */
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** Slots holding a player who is not on the bench by choice. */
const RESERVE_SLOTS = ["IR", "IR+", "NA", "IL"];

function isReserve(slot: string | null): boolean {
  return slot !== null && RESERVE_SLOTS.includes(slot.trim().toUpperCase());
}

/**
 * Which band a roster row belongs to. Decided here rather than on the surface
 * that draws it, so the order the list is sorted into and the headings printed
 * over it can never disagree about where the bench ends.
 */
function bandOf(isStarter: boolean, slot: string | null): RosterBand {
  if (isStarter) return "starting";
  return isReserve(slot) ? "reserve" : "bench";
}

const BAND_ORDER: RosterBand[] = ["starting", "bench", "reserve"];

function positionRank(position: string | null): number {
  const index = position ? POSITION_ORDER.indexOf(position) : -1;
  return index === -1 ? POSITION_ORDER.length : index;
}

/**
 * Within a band the scoring positions come in their usual order and the more
 * valuable player of two at one position comes first, which is the order a
 * trade conversation happens in.
 */
function byBandThenPosition(a: RosterPlayer, b: RosterPlayer): number {
  const bandDelta = BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band);
  if (bandDelta !== 0) return bandDelta;

  const positionDelta = positionRank(a.position) - positionRank(b.position);
  if (positionDelta !== 0) return positionDelta;

  const valueDelta = (b.value ?? -1) - (a.value ?? -1);
  if (valueDelta !== 0) return valueDelta;

  return a.name.localeCompare(b.name);
}

type RosterRow = {
  team_id: string;
  player_id: number;
  slot: string | null;
  is_starter: boolean;
  players: {
    full_name: string;
    position: string | null;
    nfl_team: string | null;
    injury_status: string | null;
    headshot_url: string | null;
  } | null;
};

/**
 * Every team's roster in one league, keyed by team id.
 *
 * A team with no rows is absent from the map rather than present and empty:
 * the caller has the team list already, and an empty roster is a state that
 * surface has to name in its own words anyway.
 */
export async function loadLeagueRosters(
  db: Db,
  leagueId: string,
): Promise<Map<string, TeamRoster>> {
  const { data, error } = await db
    .from("rosters")
    // `teams!inner` is what scopes this to one league in a single read, the
    // same way the values board counts roster spots.
    .select(
      "team_id, player_id, slot, is_starter, teams!inner(league_id), players (full_name, position, nfl_team, injury_status, headshot_url)",
    )
    .eq("teams.league_id", leagueId);

  if (error) throw new Error(`Failed to read rosters: ${error.message}`);

  const rows = (data ?? []) as unknown as RosterRow[];
  if (rows.length === 0) return new Map();

  const prices = await loadPrices(
    db,
    leagueId,
    rows.map((row) => row.player_id),
  );

  const byTeam = new Map<string, RosterPlayer[]>();

  for (const row of rows) {
    const price = prices.get(row.player_id);

    const player: RosterPlayer = {
      playerId: row.player_id,
      name: row.players?.full_name ?? `Player ${row.player_id}`,
      position: row.players?.position ?? null,
      nflTeam: row.players?.nfl_team ?? null,
      injuryStatus: row.players?.injury_status ?? null,
      headshotUrl: row.players?.headshot_url ?? null,
      slot: row.slot,
      isStarter: row.is_starter,
      value: price?.value ?? null,
      valueSource: price?.source ?? null,
      band: bandOf(row.is_starter, row.slot),
    };

    const list = byTeam.get(row.team_id);
    if (list) list.push(player);
    else byTeam.set(row.team_id, [player]);
  }

  return new Map(
    [...byTeam].map(([teamId, players]) => {
      players.sort(byBandThenPosition);

      const priced = players.filter((player) => player.value !== null);

      return [
        teamId,
        {
          teamId,
          players,
          starters: players.filter((player) => player.band === "starting")
            .length,
          value:
            priced.length === 0
              ? null
              : priced.reduce((sum, player) => sum + (player.value ?? 0), 0),
          unpriced: players.length - priced.length,
        },
      ];
    }),
  );
}

/** The league's own prices for a set of players, by player id. */
async function loadPrices(
  db: Db,
  leagueId: string,
  playerIds: number[],
): Promise<Map<number, { value: number; source: string }>> {
  const prices = new Map<number, { value: number; source: string }>();
  if (playerIds.length === 0) return prices;

  const { data, error } = await db
    .from("player_values")
    .select("player_id, value, value_source")
    .eq("league_id", leagueId)
    .in("player_id", [...new Set(playerIds)]);

  // A price is an ornament on this surface, not its subject. If the values
  // table cannot be read the rosters still can, so the plates go out without
  // their figures rather than the section refusing to render.
  if (error) return prices;

  for (const row of data ?? []) {
    prices.set(row.player_id, {
      value: Number(row.value),
      source: row.value_source,
    });
  }

  return prices;
}

import "server-only";

import { bestLineup } from "@/lib/needs/lineup";
import type { Db } from "@/lib/supabase/db";
import type { StartingSlot } from "@/lib/values/vor";

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
  /**
   * §5's rest-of-season projected points — the same `player_values.ros_points`
   * the needs vector folds and the trade page's lineup delta is measured in.
   * Null where nothing projects him, which is not zero for the usual reason.
   */
  rosPoints: number | null;
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
  /**
   * Rest-of-season projected points from the players in a starting slot. The
   * lineup is what a team scores with, so the bench is not in it; the roster's
   * whole projection is a different and much less useful number.
   */
  startingPoints: number | null;
  /** Starters with no projection, so that sum understates the lineup. */
  unprojected: number;
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
 *
 * Exported, and structural rather than typed to `RosterPlayer`, because one
 * caller re-bands a roster after reading it: the start/sit board resolves a
 * particular week's lineup, which can start a man this roster has on its bench
 * and bench a man it has starting. The rows have to be re-sorted when that
 * happens, or a promoted quarterback keeps the place he held among the bench
 * and renders under the defense.
 */
export function byBandThenPosition(
  a: { band: RosterBand; position: string | null; value: number | null; name: string },
  b: { band: RosterBand; position: string | null; value: number | null; name: string },
): number {
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
  /**
   * The league's starting slots. Given, the lineup figure below is the best
   * lineup the roster could field; withheld, it is what the stored slots say.
   *
   * Optional because two callers want different things from one read. The
   * start/sit board resolves its own lineup for a particular week and would
   * only have to undo an answer computed here; the overview is asking how good
   * a *roster* is, and the arrangement its manager happens to have out on a
   * Tuesday is not part of that question.
   */
  slots?: StartingSlot[],
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
      rosPoints: price?.rosPoints ?? null,
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

      // The lineup this roster *could* field, not the one it has out. Every
      // other judgement in this app is made that way — the needs vector, both
      // suggestion searches and the trade delta all solve from scratch — and a
      // stored arrangement is a fact about somebody's Tuesday rather than
      // about how good their team is.
      const best = slots
        ? bestLineup(
            players.map((player) => ({
              playerId: player.playerId,
              position: player.position,
              points: player.rosPoints,
            })),
            slots,
          )
        : null;

      const starting = players.filter((player) => player.band === "starting");
      const projected = starting.filter((player) => player.rosPoints !== null);

      return [
        teamId,
        {
          teamId,
          players,
          starters: best ? best.slots.length - best.empty : starting.length,
          value:
            priced.length === 0
              ? null
              : priced.reduce((sum, player) => sum + (player.value ?? 0), 0),
          unpriced: players.length - priced.length,
          startingPoints: best
            ? best.points
            : projected.length === 0
              ? null
              : projected.reduce(
                  (sum, player) => sum + (player.rosPoints ?? 0),
                  0,
                ),
          unprojected: best
            ? best.unprojected
            : starting.length - projected.length,
        },
      ];
    }),
  );
}

type Price = { value: number; source: string; rosPoints: number | null };

/**
 * The league's own prices for a set of players, by player id — and the
 * rest-of-season projection behind each one, which rides along on the same row
 * rather than costing a second read of the same table.
 */
async function loadPrices(
  db: Db,
  leagueId: string,
  playerIds: number[],
): Promise<Map<number, Price>> {
  const prices = new Map<number, Price>();
  if (playerIds.length === 0) return prices;

  const { data, error } = await db
    .from("player_values")
    .select("player_id, value, value_source, ros_points")
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
      // Postgres numerics arrive as strings often enough to be worth the cast.
      rosPoints: row.ros_points === null ? null : Number(row.ros_points),
    });
  }

  return prices;
}

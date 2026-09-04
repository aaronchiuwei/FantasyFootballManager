import "server-only";

import { randomUUID } from "node:crypto";

import type { RosterSlot } from "@/lib/sources/yahoo-parse";
import type { Db } from "@/lib/supabase/db";
import type { Json } from "@/lib/supabase/database.types";
import { searchPattern } from "@/lib/values/search";

import type { ManualLeaguePlan, ManualLeagueSettings } from "./manual-input";

/**
 * Writing a league that nobody fetched.
 *
 * The Yahoo path owns `lib/leagues/import.ts` and is untouched by any of this.
 * What the two share is the *destination*: the same `leagues`, `teams` and
 * `rosters` rows, with the same meanings. That is the whole design — once a
 * manual league is on disk, the value engine, the needs vectors, the trade
 * analyzer and both suggestion searches cannot tell it apart from an imported
 * one, and none of them were changed to accept it.
 *
 * Every function here takes the caller's own RLS-bound client. There is no
 * external API to authenticate against and no service-role work to do, so the
 * policies are the authorization, in full.
 */

/**
 * A key for a row nobody fetched.
 *
 * `yahoo_league_key` and `yahoo_team_key` are `not null` and uniquely indexed,
 * and `importLeague` upserts on those indexes — which PostgREST can only do
 * against a total unique index, not a partial one. Rather than loosen the
 * constraint the Yahoo path depends on, a manual row carries a key that is
 * unique by construction and unmistakable on sight.
 */
const MANUAL_PREFIX = "manual:";

export function manualKey(): string {
  return `${MANUAL_PREFIX}${randomUUID()}`;
}

export function isManualLeague(source: string | null | undefined): boolean {
  return source === "manual";
}

export type ManualLeagueRow = {
  id: string;
  name: string;
  source: string;
};

/** Reads a league and asserts it is one this module is allowed to write to. */
export async function requireManualLeague(
  db: Db,
  leagueId: string,
): Promise<ManualLeagueRow> {
  const { data, error } = await db
    .from("leagues")
    .select("id, name, source")
    .eq("id", leagueId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the league: ${error.message}`);
  if (!data) throw new Error("That league does not exist.");

  // Not a permissions check — RLS already made one — but a correctness one. A
  // Yahoo league's rosters are overwritten wholesale by sync stage 6, so a
  // hand edit to one is work that disappears at the next sync without saying
  // anything. Refusing is kinder than silently discarding it later.
  if (!isManualLeague(data.source)) {
    throw new Error(
      "This league is synced from Yahoo, so its rosters are managed there.",
    );
  }

  return data;
}

// ---------------------------------------------------------------------------
// the league and its teams
// ---------------------------------------------------------------------------

/**
 * Creates the league and its teams in one go.
 *
 * The first team named is marked as the user's. Every screen that says "my
 * team" reads that flag, and a league where it is unset renders a board with
 * no point of view — so it is set here and changed on the manage screen rather
 * than being one more decision on a form that already has nine.
 */
export async function createManualLeague(
  db: Db,
  userId: string,
  plan: ManualLeaguePlan,
): Promise<{ leagueId: string }> {
  const { data: league, error } = await db
    .from("leagues")
    .insert({
      user_id: userId,
      source: "manual",
      yahoo_league_key: manualKey(),
      yahoo_game_key: null,
      name: plan.name,
      season: plan.season,
      num_teams: plan.numTeams,
      scoring_type: plan.scoringType,
      ppr: plan.ppr,
      num_qbs: plan.numQbs,
      roster_slots: plan.rosterSlots as unknown as Json,
      is_dynasty: plan.isDynasty,
      // `current_week` is left for the season clock to fill in on the first
      // sync. A league created in March has no current week, and inventing one
      // would stamp a wrong week badge on the board that nothing corrects.
      start_week: plan.startWeek,
      end_week: plan.endWeek,
    })
    .select("id")
    .single();

  if (error || !league) {
    throw new Error(`Could not save the league: ${error?.message}`);
  }

  const { error: teamError } = await db.from("teams").insert(
    plan.teamNames.map((name, index) => ({
      league_id: league.id,
      yahoo_team_key: manualKey(),
      yahoo_team_id: index + 1,
      name,
      is_users_team: index === 0,
    })),
  );

  if (teamError) {
    // The league row without its teams is a board with nothing on it, and the
    // next attempt would make a second one. Cascade takes the teams with it.
    await db.from("leagues").delete().eq("id", league.id);
    throw new Error(`Could not save the teams: ${teamError.message}`);
  }

  return { leagueId: league.id };
}

/** The settings half of the manage screen. Teams and rosters are their own. */
export async function updateManualLeague(
  db: Db,
  leagueId: string,
  plan: ManualLeagueSettings,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  const { error } = await db
    .from("leagues")
    .update({
      name: plan.name,
      season: plan.season,
      scoring_type: plan.scoringType,
      ppr: plan.ppr,
      num_qbs: plan.numQbs,
      roster_slots: plan.rosterSlots as unknown as Json,
      is_dynasty: plan.isDynasty,
      // Deliberately not written: the settings form no longer carries it, and
      // saving settings must not wipe what the last sync worked out.
      start_week: plan.startWeek,
      end_week: plan.endWeek,
    })
    .eq("id", leagueId);

  if (error) throw new Error(`Could not save the settings: ${error.message}`);
}

/** Keeps `num_teams` honest after a team is added or removed. */
async function syncTeamCount(db: Db, leagueId: string): Promise<void> {
  const { count } = await db
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);

  await db
    .from("leagues")
    .update({ num_teams: count ?? 0 })
    .eq("id", leagueId);
}

export async function addManualTeam(
  db: Db,
  leagueId: string,
  name: string,
  managerName: string | null,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  const { count } = await db
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("league_id", leagueId);

  const { error } = await db.from("teams").insert({
    league_id: leagueId,
    yahoo_team_key: manualKey(),
    yahoo_team_id: (count ?? 0) + 1,
    name,
    manager_name: managerName,
    is_users_team: (count ?? 0) === 0,
  });

  if (error) throw new Error(`Could not add the team: ${error.message}`);
  await syncTeamCount(db, leagueId);
}

export type ManualTeamPatch = {
  name?: string;
  managerName?: string | null;
  wins?: number | null;
  losses?: number | null;
  ties?: number | null;
  pointsFor?: number | null;
  pointsAgainst?: number | null;
  rank?: number | null;
  faabBalance?: number | null;
};

export async function updateManualTeam(
  db: Db,
  leagueId: string,
  teamId: string,
  patch: ManualTeamPatch,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  const { error } = await db
    .from("teams")
    .update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.managerName !== undefined
        ? { manager_name: patch.managerName }
        : {}),
      ...(patch.wins !== undefined ? { wins: patch.wins } : {}),
      ...(patch.losses !== undefined ? { losses: patch.losses } : {}),
      ...(patch.ties !== undefined ? { ties: patch.ties } : {}),
      ...(patch.pointsFor !== undefined ? { points_for: patch.pointsFor } : {}),
      ...(patch.pointsAgainst !== undefined
        ? { points_against: patch.pointsAgainst }
        : {}),
      ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
      ...(patch.faabBalance !== undefined
        ? { faab_balance: patch.faabBalance }
        : {}),
    })
    .eq("id", teamId)
    .eq("league_id", leagueId);

  if (error) throw new Error(`Could not save the team: ${error.message}`);
}

/**
 * Moves the "my team" flag. Exclusive by construction: the whole league is
 * cleared first, because two teams claiming to be yours makes every "my team"
 * filter in the app pick one arbitrarily.
 */
export async function setUsersTeam(
  db: Db,
  leagueId: string,
  teamId: string,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  const { error: clearError } = await db
    .from("teams")
    .update({ is_users_team: false })
    .eq("league_id", leagueId)
    .neq("id", teamId);

  if (clearError) {
    throw new Error(`Could not move the flag: ${clearError.message}`);
  }

  const { error } = await db
    .from("teams")
    .update({ is_users_team: true })
    .eq("id", teamId)
    .eq("league_id", leagueId);

  if (error) throw new Error(`Could not set your team: ${error.message}`);
}

/** Below this a league cannot hold a matchup, a trade, or a needs comparison. */
const MIN_TEAMS = 2;

export async function deleteManualTeam(
  db: Db,
  leagueId: string,
  teamId: string,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  const { data: teams, error: readError } = await db
    .from("teams")
    .select("id, is_users_team")
    .eq("league_id", leagueId);

  if (readError) throw new Error(`Could not read the teams: ${readError.message}`);

  const rows = teams ?? [];
  const doomed = rows.find((team) => team.id === teamId);
  if (!doomed) throw new Error("That team is not in this league.");

  // The button is disabled at this point too, but a disabled button is a
  // courtesy and this is the rule. A one-team league prices nothing: every
  // needs vector is measured against the rest of the league, and there is no
  // rest of the league.
  if (rows.length <= MIN_TEAMS) {
    throw new Error(`A league needs at least ${MIN_TEAMS} teams.`);
  }

  const { error } = await db
    .from("teams")
    .delete()
    .eq("id", teamId)
    .eq("league_id", leagueId);

  if (error) throw new Error(`Could not remove the team: ${error.message}`);

  // Deleting your own team would otherwise leave the league with no point of
  // view: "My team" on the values board matches nothing, and the trade
  // analyzer opens on an arbitrary side. The flag moves rather than vanishing.
  if (doomed.is_users_team) {
    const heir = rows.find((team) => team.id !== teamId);
    if (heir) await setUsersTeam(db, leagueId, heir.id);
  }

  await syncTeamCount(db, leagueId);
}

// ---------------------------------------------------------------------------
// rosters
// ---------------------------------------------------------------------------

/** Every team id in a league, for the "is he already owned here" checks. */
export async function teamIdsOf(db: Db, leagueId: string): Promise<string[]> {
  const { data, error } = await db
    .from("teams")
    .select("id")
    .eq("league_id", leagueId);

  if (error) throw new Error(`Could not read the teams: ${error.message}`);
  return (data ?? []).map((team) => team.id);
}

/**
 * Puts a player on a roster, taking him off whichever roster in this league
 * already had him.
 *
 * The move is the point. `rosters` is keyed `(team_id, player_id)`, so nothing
 * in the schema stops the same player sitting on two rosters at once — and a
 * league where that happened would double-count him in every needs vector and
 * offer him in trades from both sides. One owner per player, per league, is an
 * invariant this function is the only writer of.
 */
export async function setRosterEntry(
  db: Db,
  leagueId: string,
  teamId: string,
  playerId: number,
  slot: string | null,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  const teamIds = await teamIdsOf(db, leagueId);
  if (!teamIds.includes(teamId)) throw new Error("That team is not in this league.");

  const others = teamIds.filter((id) => id !== teamId);
  if (others.length > 0) {
    const { error: clearError } = await db
      .from("rosters")
      .delete()
      .eq("player_id", playerId)
      .in("team_id", others);

    if (clearError) {
      throw new Error(`Could not clear the old roster: ${clearError.message}`);
    }
  }

  const { error } = await db.from("rosters").upsert(
    {
      team_id: teamId,
      player_id: playerId,
      slot,
      is_starter: slot !== null && slot !== "BN" && slot !== "IR",
      yahoo_player_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "team_id,player_id" },
  );

  if (error) throw new Error(`Could not save the roster: ${error.message}`);
}

export async function removeRosterEntry(
  db: Db,
  leagueId: string,
  teamId: string,
  playerId: number,
): Promise<void> {
  await requireManualLeague(db, leagueId);

  // Scoped the same way `setRosterEntry` is. RLS already confines this to
  // leagues the caller owns, so an unchecked `teamId` was never a way into
  // someone else's data — but it was a way to delete a roster row from
  // *another of your own* leagues, which is a bug rather than an attack.
  const teamIds = await teamIdsOf(db, leagueId);
  if (!teamIds.includes(teamId)) throw new Error("That team is not in this league.");

  const { error } = await db
    .from("rosters")
    .delete()
    .eq("team_id", teamId)
    .eq("player_id", playerId);

  if (error) throw new Error(`Could not drop the player: ${error.message}`);
}

export type RosterEntry = {
  playerId: number;
  name: string;
  position: string | null;
  nflTeam: string | null;
  injuryStatus: string | null;
  headshotUrl: string | null;
  slot: string | null;
  isStarter: boolean;
};

export async function loadTeamRoster(
  db: Db,
  teamId: string,
): Promise<RosterEntry[]> {
  const { data, error } = await db
    .from("rosters")
    .select(
      "player_id, slot, is_starter, players (full_name, position, nfl_team, injury_status, headshot_url)",
    )
    .eq("team_id", teamId);

  if (error) throw new Error(`Could not read the roster: ${error.message}`);

  type Joined = {
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

  return (data as unknown as Joined[])
    .map((row) => ({
      playerId: row.player_id,
      name: row.players?.full_name ?? `Player ${row.player_id}`,
      position: row.players?.position ?? null,
      nflTeam: row.players?.nfl_team ?? null,
      injuryStatus: row.players?.injury_status ?? null,
      headshotUrl: row.players?.headshot_url ?? null,
      slot: row.slot,
      isStarter: row.is_starter,
    }))
    .sort(byPositionThenName);
}

/** The order a roster is read in: scoring positions first, then by name. */
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

function byPositionThenName(a: RosterEntry, b: RosterEntry): number {
  const rankOf = (position: string | null) => {
    const index = position ? POSITION_ORDER.indexOf(position) : -1;
    return index === -1 ? POSITION_ORDER.length : index;
  };

  const delta = rankOf(a.position) - rankOf(b.position);
  return delta !== 0 ? delta : a.name.localeCompare(b.name);
}

// ---------------------------------------------------------------------------
// the player picker
// ---------------------------------------------------------------------------

/** Enough to choose from, few enough that the list is still a list. */
const SEARCH_LIMIT = 15;

/** Positions a fantasy roster has a slot for. The master list has many more. */
const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

export type PlayerHit = {
  playerId: number;
  name: string;
  position: string | null;
  nflTeam: string | null;
  injuryStatus: string | null;
  /** The team in this league that already holds him, if any. */
  ownedBy: { teamId: string; teamName: string } | null;
};

/**
 * The master list, searched by name, annotated with who in this league owns
 * each hit.
 *
 * The ownership half is what makes the picker usable rather than merely
 * functional. Typing a name into a hand-kept league is the moment you are most
 * likely to be wrong about who has him, and a row that says so before you
 * click is worth more than an error afterwards.
 */
export async function searchLeaguePlayers(
  db: Db,
  leagueId: string,
  query: string,
): Promise<PlayerHit[]> {
  const pattern = searchPattern(query);
  if (!pattern) return [];

  const { data, error } = await db
    .from("players")
    .select("id, full_name, position, nfl_team, injury_status")
    .ilike("full_name", pattern)
    .in("position", FANTASY_POSITIONS)
    .order("full_name")
    .limit(SEARCH_LIMIT);

  if (error) throw new Error(`Could not search players: ${error.message}`);

  const hits = data ?? [];
  if (hits.length === 0) return [];

  const { data: owners } = await db
    .from("rosters")
    .select("player_id, teams!inner (id, name, league_id)")
    .in(
      "player_id",
      hits.map((hit) => hit.id),
    )
    .eq("teams.league_id", leagueId);

  type Owner = {
    player_id: number;
    teams: { id: string; name: string } | null;
  };

  const ownerByPlayer = new Map<number, { teamId: string; teamName: string }>();
  for (const row of (owners ?? []) as unknown as Owner[]) {
    if (row.teams) {
      ownerByPlayer.set(row.player_id, {
        teamId: row.teams.id,
        teamName: row.teams.name,
      });
    }
  }

  return hits.map((hit) => ({
    playerId: hit.id,
    name: hit.full_name,
    position: hit.position,
    nflTeam: hit.nfl_team,
    injuryStatus: hit.injury_status,
    ownedBy: ownerByPlayer.get(hit.id) ?? null,
  }));
}

/**
 * True once Sleeper's master list has been pulled at least once (stage 2).
 *
 * Existence, not a count. The manage screen asks this on every render only to
 * decide whether the picker can find anything, and counting eleven thousand
 * rows to answer a yes/no question is eleven thousand rows too many.
 */
export async function hasPlayerMaster(db: Db): Promise<boolean> {
  const { data, error } = await db.from("players").select("id").limit(1);

  if (error) throw new Error(`Could not read the player list: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The starting slots a league offers, for the roster editor's slot picker. */
export function slotOptions(rosterSlots: RosterSlot[]): string[] {
  const slots = rosterSlots
    .filter((slot) => slot.count > 0)
    .map((slot) => slot.position);

  // A league that never named a bench still has one — you cannot hold a player
  // without somewhere to hold him.
  return slots.includes("BN") ? slots : [...slots, "BN"];
}

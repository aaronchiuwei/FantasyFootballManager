import "server-only";

import { chunk, loadPlayers, syncPlayerMaster, type PlayerRow } from "@/lib/players/master";
import { fetchDynastyProcessIds } from "@/lib/sources/dynastyprocess";
import {
  fetchFantasyCalcValues,
  type FantasyCalcPlayer,
} from "@/lib/sources/fantasycalc";
import type { SleeperPlayer } from "@/lib/sources/sleeper";
import {
  fetchFreeAgents,
  fetchRosters,
  type YahooPlayer,
} from "@/lib/sources/yahoo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/database.types";

import {
  CandidateIndex,
  type CrosswalkCandidate,
  type MatchMethod,
  type Resolution,
  type UnmatchedPayload,
} from "./resolve";

export type { UnmatchedPayload } from "./resolve";

type Admin = ReturnType<typeof createAdminClient>;
type CrosswalkInsert = Database["public"]["Tables"]["player_crosswalk"]["Insert"];

/** Ladder rank 2 and 3 of §4 — persisted once, then consulted by key. */
const DYNASTYPROCESS_CONFIDENCE = 0.98;
const SLEEPER_ID_CONFIDENCE = 0.97;

const YAHOO = "yahoo";
const FANTASYCALC = "fantasycalc";

/** PostgREST builds one URL per request, so `.in()` lists stay modest. */
const FILTER_CHUNK = 100;
const INSERT_CHUNK = 500;

// ---------------------------------------------------------------------------
// seeding
// ---------------------------------------------------------------------------

function playerIdsBySleeperId(rows: PlayerRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.sleeper_id) map.set(row.sleeper_id, row.id);
  }
  return map;
}

export function toCandidates(rows: PlayerRow[]): CrosswalkCandidate[] {
  return rows.map((row) => ({
    playerId: row.id,
    searchName: row.search_name,
    fullName: row.full_name,
    position: row.position,
    nflTeam: row.nfl_team,
    birthDate: row.birth_date,
  }));
}

async function insertCrosswalk(admin: Admin, rows: CrosswalkInsert[]) {
  for (const batch of chunk(rows, INSERT_CHUNK)) {
    // Never clobber what is already there: a row written by the name ladder or
    // an admin override outranks a re-seed of the same key.
    const { error } = await admin
      .from("player_crosswalk")
      .upsert(batch, { onConflict: "source,source_id", ignoreDuplicates: true });

    if (error) throw new Error(`Failed to write crosswalk: ${error.message}`);
  }
}

/**
 * Seeds `yahoo_id → player_id` from the two sources that ship the pair
 * outright: DynastyProcess's `db_playerids.csv` (§4 step 2, ~77% of the top
 * 192) and Sleeper's own sparse `yahoo_id` (§4 step 3). DynastyProcess goes in
 * first so it wins the key where both have an opinion.
 */
export async function seedYahooCrosswalk(
  admin: Admin,
  players: PlayerRow[],
  sleeperPlayers: SleeperPlayer[],
): Promise<{ seeded: number; warning: string | null }> {
  const bySleeperId = playerIdsBySleeperId(players);
  const seen = new Set<string>();
  const rows: CrosswalkInsert[] = [];
  let warning: string | null = null;

  try {
    for (const row of await fetchDynastyProcessIds()) {
      const playerId = row.sleeperId ? bySleeperId.get(row.sleeperId) : undefined;
      if (!playerId || !row.yahooId || seen.has(row.yahooId)) continue;

      seen.add(row.yahooId);
      rows.push({
        source: YAHOO,
        source_id: row.yahooId,
        player_id: playerId,
        match_method: "dynastyprocess",
        confidence: DYNASTYPROCESS_CONFIDENCE,
      });
    }
  } catch (cause) {
    // GitHub being down costs coverage, not correctness — the name ladder
    // still runs, and the next sync re-seeds.
    warning =
      cause instanceof Error
        ? `DynastyProcess crosswalk unavailable: ${cause.message}`
        : "DynastyProcess crosswalk unavailable.";
  }

  for (const player of sleeperPlayers) {
    if (!player.yahooId || seen.has(player.yahooId)) continue;
    const playerId = bySleeperId.get(player.sleeperId);
    if (!playerId) continue;

    seen.add(player.yahooId);
    rows.push({
      source: YAHOO,
      source_id: player.yahooId,
      player_id: playerId,
      match_method: "sleeper_yahoo_id",
      confidence: SLEEPER_ID_CONFIDENCE,
    });
  }

  await insertCrosswalk(admin, rows);
  return { seeded: rows.length, warning };
}

/**
 * The right half of the join (§4): FantasyCalc ships `sleeperId`, so this is
 * exact and free. Seeding it here means Phase 3 can look values up by
 * `player_id` without re-deriving identity.
 */
export async function seedFantasyCalcCrosswalk(
  admin: Admin,
  players: PlayerRow[],
  params: { numQbs: number; numTeams: number; ppr: number },
): Promise<number> {
  return seedFantasyCalcCrosswalkFrom(
    admin,
    players,
    await fetchFantasyCalcValues(params),
  );
}

/**
 * The same seeding pass over an already-fetched value list. The value engine
 * needs those rows for its own work, and FantasyCalc is undocumented enough
 * (§12) that pulling it twice in one run is a cost with no upside.
 */
export async function seedFantasyCalcCrosswalkFrom(
  admin: Admin,
  players: PlayerRow[],
  values: FantasyCalcPlayer[],
): Promise<number> {
  const bySleeperId = playerIdsBySleeperId(players);
  const rows: CrosswalkInsert[] = [];

  for (const value of values) {
    const playerId = value.sleeperId ? bySleeperId.get(value.sleeperId) : undefined;
    if (!playerId) continue;

    rows.push({
      source: FANTASYCALC,
      source_id: String(value.fantasyCalcId),
      player_id: playerId,
      match_method: "sleeper_id",
      confidence: 1,
    });
  }

  await insertCrosswalk(admin, rows);
  return rows.length;
}

// ---------------------------------------------------------------------------
// resolution
// ---------------------------------------------------------------------------

export type ResolutionReport = {
  playersInMaster: number;
  masterRefreshed: boolean;
  rostered: number;
  rosteredResolved: number;
  freeAgents: number;
  freeAgentsResolved: number;
  unmatched: number;
  byMethod: Partial<Record<MatchMethod, number>>;
  marketCoverage: number | null;
  warnings: string[];
};

type Target = {
  player: YahooPlayer;
  teamKey: string | null;
};

async function fetchKeyed<T extends { source_id: string }>(
  admin: Admin,
  table: "player_crosswalk" | "player_id_overrides",
  columns: string,
  sourceIds: string[],
): Promise<Map<string, T>> {
  const map = new Map<string, T>();

  for (const batch of chunk(sourceIds, FILTER_CHUNK)) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq("source", YAHOO)
      .in("source_id", batch);

    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    for (const row of (data ?? []) as unknown as T[]) map.set(row.source_id, row);
  }

  return map;
}

/**
 * Runs the full §4 ladder over everything Yahoo says is in this league —
 * every rostered player plus the top free agents — and persists the outcome.
 *
 * Idempotent: resolutions already in `player_crosswalk` are reused rather than
 * recomputed, so the name-matching work happens once per player, not once per
 * sync. Phase 4 turns this into sync stage 7.
 */
export async function resolveLeagueIdentities(
  userId: string,
  leagueId: string,
): Promise<ResolutionReport> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const warnings: string[] = [];

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, yahoo_league_key, num_qbs, num_teams, ppr")
    .eq("id", leagueId)
    .single();

  if (leagueError || !league) {
    throw new Error(`League not found: ${leagueError?.message ?? leagueId}`);
  }

  const master = await syncPlayerMaster();
  const players = await loadPlayers(admin);

  if (master.refreshed && master.players) {
    const seed = await seedYahooCrosswalk(admin, players, master.players);
    if (seed.warning) warnings.push(seed.warning);
  }

  // Yahoo first (rosters, then the paginated free-agent pull), so a Yahoo
  // failure costs nothing downstream.
  const rosters = await fetchRosters(userId, league.yahoo_league_key);
  const freeAgents = await fetchFreeAgents(userId, league.yahoo_league_key);

  const targets = new Map<string, Target>();
  for (const roster of rosters) {
    for (const player of roster.players) {
      targets.set(player.playerId, { player, teamKey: roster.teamKey });
    }
  }
  for (const player of freeAgents) {
    // A player on a roster is never also a free agent, but Yahoo's pagination
    // can overlap with itself; the roster entry is the richer one.
    if (!targets.has(player.playerId)) {
      targets.set(player.playerId, { player, teamKey: null });
    }
  }

  const sourceIds = [...targets.keys()];
  const [overrides, existing] = await Promise.all([
    fetchKeyed<{ source_id: string; player_id: number }>(
      admin,
      "player_id_overrides",
      "source_id, player_id",
      sourceIds,
    ),
    fetchKeyed<{
      source_id: string;
      player_id: number;
      match_method: string;
      confidence: number;
    }>(
      admin,
      "player_crosswalk",
      "source_id, player_id, match_method, confidence",
      sourceIds,
    ),
  ]);

  const index = new CandidateIndex(toCandidates(players));
  const resolved = new Map<string, Resolution>();
  const unresolved: Target[] = [];
  const fresh: CrosswalkInsert[] = [];
  const byMethod: Partial<Record<MatchMethod, number>> = {};

  for (const [sourceId, target] of targets) {
    const override = overrides.get(sourceId);
    const known = existing.get(sourceId);

    let resolution: Resolution | null = null;

    if (override) {
      resolution = { playerId: override.player_id, method: "override", confidence: 1 };
    } else if (known) {
      resolution = {
        playerId: known.player_id,
        method: known.match_method as MatchMethod,
        confidence: known.confidence,
      };
    } else {
      resolution = index.match({
        sourceId,
        name: target.player.name,
        position: target.player.position,
        nflTeam: target.player.nflTeam,
        isDefense: target.player.isDefense,
      });

      if (resolution) {
        fresh.push({
          source: YAHOO,
          source_id: sourceId,
          player_id: resolution.playerId,
          match_method: resolution.method,
          confidence: resolution.confidence,
        });
      }
    }

    if (resolution) {
      resolved.set(sourceId, resolution);
      byMethod[resolution.method] = (byMethod[resolution.method] ?? 0) + 1;
    } else {
      unresolved.push(target);
    }
  }

  await insertCrosswalk(admin, fresh);

  await writeRosters(supabase, leagueId, rosters, resolved);
  await writeUnmatched(supabase, leagueId, unresolved, resolved);

  let marketCoverage: number | null = null;
  try {
    marketCoverage = await seedFantasyCalcCrosswalk(admin, players, {
      numQbs: league.num_qbs,
      numTeams: league.num_teams ?? 12,
      ppr: Number(league.ppr),
    });
  } catch (cause) {
    warnings.push(
      cause instanceof Error
        ? `FantasyCalc unavailable: ${cause.message}`
        : "FantasyCalc unavailable.",
    );
  }

  const rosteredIds = rosters.flatMap((roster) =>
    roster.players.map((player) => player.playerId),
  );

  return {
    playersInMaster: master.count,
    masterRefreshed: master.refreshed,
    rostered: rosteredIds.length,
    rosteredResolved: rosteredIds.filter((id) => resolved.has(id)).length,
    freeAgents: freeAgents.length,
    freeAgentsResolved: freeAgents.filter((player) => resolved.has(player.playerId))
      .length,
    unmatched: unresolved.length,
    byMethod,
    marketCoverage,
    warnings,
  };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

async function teamIdsByKey(supabase: ServerClient, leagueId: string) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, yahoo_team_key")
    .eq("league_id", leagueId);

  if (error) throw new Error(`Failed to read teams: ${error.message}`);
  return new Map((data ?? []).map((team) => [team.yahoo_team_key, team.id]));
}

/**
 * Replaces the league's rosters with the resolved players. Rewritten whole
 * rather than diffed: a roster is a snapshot of Yahoo's truth, and a dropped
 * player must not linger.
 */
async function writeRosters(
  supabase: ServerClient,
  leagueId: string,
  rosters: Awaited<ReturnType<typeof fetchRosters>>,
  resolved: Map<string, Resolution>,
) {
  const teamIds = await teamIdsByKey(supabase, leagueId);
  if (teamIds.size === 0) return;

  const { error: clearError } = await supabase
    .from("rosters")
    .delete()
    .in("team_id", [...teamIds.values()]);

  if (clearError) throw new Error(`Failed to clear rosters: ${clearError.message}`);

  const rows = new Map<string, Database["public"]["Tables"]["rosters"]["Insert"]>();

  for (const roster of rosters) {
    const teamId = teamIds.get(roster.teamKey);
    if (!teamId) continue;

    for (const player of roster.players) {
      const resolution = resolved.get(player.playerId);
      if (!resolution) continue;

      rows.set(`${teamId}:${resolution.playerId}`, {
        team_id: teamId,
        player_id: resolution.playerId,
        slot: player.selectedPosition,
        is_starter: player.isStarter,
        yahoo_player_id: player.playerId,
      });
    }
  }

  for (const batch of chunk([...rows.values()], INSERT_CHUNK)) {
    const { error } = await supabase
      .from("rosters")
      .upsert(batch, { onConflict: "team_id,player_id" });

    if (error) throw new Error(`Failed to save rosters: ${error.message}`);
  }
}

function toPayload(target: Target): UnmatchedPayload {
  return {
    playerKey: target.player.playerKey,
    name: target.player.name,
    position: target.player.position,
    nflTeam: target.player.nflTeam,
    isDefense: target.player.isDefense,
    status: target.player.status,
    teamKey: target.teamKey,
    slot: target.player.selectedPosition,
    isStarter: target.player.isStarter,
  };
}

/**
 * Every miss is written down — §13's rule is that an unresolved player must
 * appear in `unmatched_players`, never be silently dropped. Rows resolved
 * since the last run are closed out rather than deleted, so the admin screen
 * keeps a record of what it fixed.
 */
async function writeUnmatched(
  supabase: ServerClient,
  leagueId: string,
  unresolved: Target[],
  resolved: Map<string, Resolution>,
) {
  if (unresolved.length > 0) {
    const rows = unresolved.map((target) => ({
      league_id: leagueId,
      yahoo_player_id: target.player.playerId,
      payload: toPayload(target) as unknown as Json,
      resolved_at: null,
      resolved_player_id: null,
    }));

    for (const batch of chunk(rows, INSERT_CHUNK)) {
      const { error } = await supabase
        .from("unmatched_players")
        .upsert(batch, { onConflict: "league_id,yahoo_player_id" });

      if (error) throw new Error(`Failed to save unmatched: ${error.message}`);
    }
  }

  const { data: pending, error } = await supabase
    .from("unmatched_players")
    .select("id, yahoo_player_id")
    .eq("league_id", leagueId)
    .is("resolved_at", null);

  if (error) throw new Error(`Failed to read unmatched: ${error.message}`);

  const now = new Date().toISOString();
  for (const row of pending ?? []) {
    const resolution = resolved.get(row.yahoo_player_id);
    if (!resolution) continue;

    await supabase
      .from("unmatched_players")
      .update({ resolved_at: now, resolved_player_id: resolution.playerId })
      .eq("id", row.id);
  }
}

// ---------------------------------------------------------------------------
// admin resolution UI (§4)
// ---------------------------------------------------------------------------

export type UnmatchedEntry = {
  id: string;
  yahooPlayerId: string;
  payload: UnmatchedPayload;
  suggestions: CrosswalkCandidate[];
};

export type IdentityStatus = {
  playersInMaster: number;
  masterUpdatedAt: string | null;
  rostered: number;
  unmatched: UnmatchedEntry[];
};

/**
 * Everything the identity screen renders: coverage counts plus each unresolved
 * player with its ranked "did you mean" list.
 */
export async function getIdentityStatus(
  leagueId: string,
): Promise<IdentityStatus> {
  const supabase = await createClient();

  const teamIds = [...(await teamIdsByKey(supabase, leagueId)).values()];

  const [{ count: playersInMaster }, { data: newest }, rosterCount, { data: pending }] =
    await Promise.all([
      supabase.from("players").select("id", { count: "exact", head: true }),
      supabase
        .from("players")
        .select("updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      teamIds.length === 0
        ? Promise.resolve({ count: 0 })
        : supabase
            .from("rosters")
            .select("player_id", { count: "exact", head: true })
            .in("team_id", teamIds),
      supabase
        .from("unmatched_players")
        .select("id, yahoo_player_id, payload")
        .eq("league_id", leagueId)
        .is("resolved_at", null)
        .order("created_at"),
    ]);

  const rows = pending ?? [];
  const index =
    rows.length > 0
      ? new CandidateIndex(toCandidates(await loadPlayers(createAdminClient())))
      : null;

  return {
    playersInMaster: playersInMaster ?? 0,
    masterUpdatedAt: newest?.updated_at ?? null,
    rostered: rosterCount.count ?? 0,
    unmatched: rows.map((row) => {
      const payload = row.payload as unknown as UnmatchedPayload;
      return {
        id: row.id,
        yahooPlayerId: row.yahoo_player_id,
        payload,
        suggestions:
          index?.suggest({
            sourceId: row.yahoo_player_id,
            name: payload.name,
            position: payload.position,
            nflTeam: payload.nflTeam,
            isDefense: payload.isDefense,
          }) ?? [],
      };
    }),
  };
}

/**
 * "These are the same person." Writes the manual override that outranks every
 * other rung of the ladder (§4 step 1), then applies it immediately — the
 * crosswalk row, the roster slot the player was missing from, and closing out
 * the unmatched entry — so one click is genuinely one click.
 */
export async function applyOverride(
  userId: string,
  {
    leagueId,
    unmatchedId,
    playerId,
  }: { leagueId: string; unmatchedId: string; playerId: number },
): Promise<{ name: string }> {
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: row, error } = await supabase
    .from("unmatched_players")
    .select("id, yahoo_player_id, payload")
    .eq("id", unmatchedId)
    .eq("league_id", leagueId)
    .single();

  if (error || !row) {
    throw new Error(`Unmatched player not found: ${error?.message ?? unmatchedId}`);
  }

  const payload = row.payload as unknown as UnmatchedPayload;

  // Written with the user's own client so `created_by` is real and the
  // override policies do the authorizing. There is no update policy on this
  // table by design, so a re-decision replaces rather than edits.
  await supabase
    .from("player_id_overrides")
    .delete()
    .eq("source", YAHOO)
    .eq("source_id", row.yahoo_player_id);

  const { error: overrideError } = await supabase
    .from("player_id_overrides")
    .insert({
      source: YAHOO,
      source_id: row.yahoo_player_id,
      player_id: playerId,
      created_by: userId,
      note: `Resolved "${payload.name}" from the identity screen`,
    });

  if (overrideError) {
    throw new Error(`Failed to save override: ${overrideError.message}`);
  }

  const { error: crosswalkError } = await admin.from("player_crosswalk").upsert(
    {
      source: YAHOO,
      source_id: row.yahoo_player_id,
      player_id: playerId,
      match_method: "override",
      confidence: 1,
    },
    { onConflict: "source,source_id" },
  );

  if (crosswalkError) {
    throw new Error(`Failed to save crosswalk: ${crosswalkError.message}`);
  }

  if (payload.teamKey) {
    const teamId = (await teamIdsByKey(supabase, leagueId)).get(payload.teamKey);
    if (teamId) {
      const { error: rosterError } = await supabase.from("rosters").upsert(
        {
          team_id: teamId,
          player_id: playerId,
          slot: payload.slot,
          is_starter: payload.isStarter,
          yahoo_player_id: row.yahoo_player_id,
        },
        { onConflict: "team_id,player_id" },
      );

      if (rosterError) {
        throw new Error(`Failed to save roster slot: ${rosterError.message}`);
      }
    }
  }

  const { error: closeError } = await supabase
    .from("unmatched_players")
    .update({ resolved_at: new Date().toISOString(), resolved_player_id: playerId })
    .eq("id", row.id);

  if (closeError) {
    throw new Error(`Failed to close unmatched row: ${closeError.message}`);
  }

  return { name: payload.name };
}

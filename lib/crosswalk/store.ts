import "server-only";

import { teamIdsByKey } from "@/lib/leagues/import";
import { chunk, loadPlayers, type PlayerRow } from "@/lib/players/master";
import { fetchDynastyProcessIds } from "@/lib/sources/dynastyprocess";
import type { FantasyCalcPlayer } from "@/lib/sources/fantasycalc";
import type { SleeperPlayer } from "@/lib/sources/sleeper";
import type { TeamRoster, YahooPlayer } from "@/lib/sources/yahoo";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Db } from "@/lib/supabase/db";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

import {
  CandidateIndex,
  type CrosswalkCandidate,
  type MatchMethod,
  type Resolution,
  type UnmatchedPayload,
} from "./resolve";

export type { UnmatchedPayload } from "./resolve";

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

async function insertCrosswalk(db: Db, rows: CrosswalkInsert[]) {
  for (const batch of chunk(rows, INSERT_CHUNK)) {
    // Never clobber what is already there: a row written by the name ladder or
    // an admin override outranks a re-seed of the same key.
    const { error } = await db
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
  db: Db,
  ids: Map<string, number>,
  sleeperPlayers: SleeperPlayer[],
): Promise<{ seeded: number; warning: string | null }> {
  const seen = new Set<string>();
  const rows: CrosswalkInsert[] = [];
  let warning: string | null = null;

  try {
    for (const row of await fetchDynastyProcessIds()) {
      const playerId = row.sleeperId ? ids.get(row.sleeperId) : undefined;
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
    const playerId = ids.get(player.sleeperId);
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

  await insertCrosswalk(db, rows);
  return { seeded: rows.length, warning };
}

/**
 * The right half of the join (§4): FantasyCalc ships `sleeperId`, so this is
 * exact and free. Seeded from the board sync stage 3 already fetched, so the
 * undocumented API (§12) is pulled once per run and not twice.
 */
export async function seedFantasyCalcCrosswalkFrom(
  db: Db,
  ids: Map<string, number>,
  values: FantasyCalcPlayer[],
): Promise<number> {
  const rows: CrosswalkInsert[] = [];

  for (const value of values) {
    const playerId = value.sleeperId ? ids.get(value.sleeperId) : undefined;
    if (!playerId) continue;

    rows.push({
      source: FANTASYCALC,
      source_id: String(value.fantasyCalcId),
      player_id: playerId,
      match_method: "sleeper_id",
      confidence: 1,
    });
  }

  await insertCrosswalk(db, rows);
  return rows.length;
}

// ---------------------------------------------------------------------------
// stage 6's half: what Yahoo says is in the league
// ---------------------------------------------------------------------------

export type PoolEntry = {
  yahooPlayerId: string;
  /** Null means free agent. */
  teamKey: string | null;
  player: YahooPlayer;
};

/**
 * Persists the league's player pool exactly as Yahoo reported it, before
 * identity resolution has an opinion about any of it.
 *
 * This is the seam between stages 6 and 7. It exists so that a resolve that
 * fails can be retried without paying Yahoo's free-agent pagination again —
 * which is §9's "independently retryable" applied to the one stage where a
 * retry would otherwise be expensive.
 */
export async function savePlayerPool(
  db: Db,
  leagueId: string,
  { rosters, freeAgents }: { rosters: TeamRoster[]; freeAgents: YahooPlayer[] },
): Promise<{ rostered: number; freeAgents: number }> {
  const entries = new Map<string, PoolEntry>();

  for (const roster of rosters) {
    for (const player of roster.players) {
      entries.set(player.playerId, {
        yahooPlayerId: player.playerId,
        teamKey: roster.teamKey,
        player,
      });
    }
  }

  for (const player of freeAgents) {
    // A rostered player is never also a free agent, but Yahoo's pagination can
    // overlap with itself; the roster entry is the richer one.
    if (entries.has(player.playerId)) continue;
    entries.set(player.playerId, {
      yahooPlayerId: player.playerId,
      teamKey: null,
      player,
    });
  }

  const fetchedAt = new Date().toISOString();
  const rows = [...entries.values()].map((entry) => ({
    league_id: leagueId,
    yahoo_player_id: entry.yahooPlayerId,
    team_key: entry.teamKey,
    payload: entry.player as unknown as Json,
    fetched_at: fetchedAt,
  }));

  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const { error } = await db
      .from("yahoo_player_pool")
      .upsert(batch, { onConflict: "league_id,yahoo_player_id" });

    if (error) throw new Error(`Failed to save the player pool: ${error.message}`);
  }

  // Dropped players and players who left the free-agent window are gone from
  // Yahoo's answer, so they go from ours.
  const { error: pruneError } = await db
    .from("yahoo_player_pool")
    .delete()
    .eq("league_id", leagueId)
    .lt("fetched_at", fetchedAt);

  if (pruneError) {
    throw new Error(`Failed to prune the player pool: ${pruneError.message}`);
  }

  return {
    rostered: [...entries.values()].filter((entry) => entry.teamKey !== null).length,
    freeAgents: [...entries.values()].filter((entry) => entry.teamKey === null).length,
  };
}

async function loadPlayerPool(db: Db, leagueId: string): Promise<PoolEntry[]> {
  const entries: PoolEntry[] = [];

  for (let from = 0; ; from += INSERT_CHUNK) {
    const { data, error } = await db
      .from("yahoo_player_pool")
      .select("yahoo_player_id, team_key, payload")
      .eq("league_id", leagueId)
      .order("yahoo_player_id")
      .range(from, from + INSERT_CHUNK - 1);

    if (error) throw new Error(`Failed to read the player pool: ${error.message}`);

    for (const row of data ?? []) {
      entries.push({
        yahooPlayerId: row.yahoo_player_id,
        teamKey: row.team_key,
        player: row.payload as unknown as YahooPlayer,
      });
    }

    if (!data || data.length < INSERT_CHUNK) break;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// stage 7: resolution
// ---------------------------------------------------------------------------

export type ResolutionReport = {
  rostered: number;
  rosteredResolved: number;
  freeAgents: number;
  freeAgentsResolved: number;
  unmatched: number;
  byMethod: Partial<Record<MatchMethod, number>>;
};

async function fetchKeyed<T extends { source_id: string }>(
  db: Db,
  table: "player_crosswalk" | "player_id_overrides",
  columns: string,
  sourceIds: string[],
): Promise<Map<string, T>> {
  const map = new Map<string, T>();

  for (const batch of chunk(sourceIds, FILTER_CHUNK)) {
    const { data, error } = await db
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
 * Sync stage 7: runs the full §4 ladder over the persisted pool.
 *
 * Idempotent, and cheap on a re-run: resolutions already in
 * `player_crosswalk` are reused rather than recomputed, so the name-matching
 * work happens once per player, not once per sync.
 */
export async function resolvePool(
  db: Db,
  leagueId: string,
): Promise<ResolutionReport> {
  const [pool, players] = await Promise.all([
    loadPlayerPool(db, leagueId),
    loadPlayers(db),
  ]);

  const sourceIds = pool.map((entry) => entry.yahooPlayerId);
  const [overrides, existing] = await Promise.all([
    fetchKeyed<{ source_id: string; player_id: number }>(
      db,
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
      db,
      "player_crosswalk",
      "source_id, player_id, match_method, confidence",
      sourceIds,
    ),
  ]);

  const index = new CandidateIndex(toCandidates(players));
  const resolved = new Map<string, Resolution>();
  const unresolved: PoolEntry[] = [];
  const fresh: CrosswalkInsert[] = [];
  const byMethod: Partial<Record<MatchMethod, number>> = {};

  for (const entry of pool) {
    const sourceId = entry.yahooPlayerId;
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
        name: entry.player.name,
        position: entry.player.position,
        nflTeam: entry.player.nflTeam,
        isDefense: entry.player.isDefense,
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
      unresolved.push(entry);
    }
  }

  await insertCrosswalk(db, fresh);
  await writeRosters(db, leagueId, pool, resolved);
  await writeUnmatched(db, leagueId, unresolved, resolved);

  const rostered = pool.filter((entry) => entry.teamKey !== null);
  const freeAgents = pool.filter((entry) => entry.teamKey === null);

  return {
    rostered: rostered.length,
    rosteredResolved: rostered.filter((entry) => resolved.has(entry.yahooPlayerId))
      .length,
    freeAgents: freeAgents.length,
    freeAgentsResolved: freeAgents.filter((entry) =>
      resolved.has(entry.yahooPlayerId),
    ).length,
    unmatched: unresolved.length,
    byMethod,
  };
}

/**
 * Replaces the league's rosters with the resolved players. Rewritten whole
 * rather than diffed: a roster is a snapshot of Yahoo's truth, and a dropped
 * player must not linger.
 */
async function writeRosters(
  db: Db,
  leagueId: string,
  pool: PoolEntry[],
  resolved: Map<string, Resolution>,
) {
  const teamIds = await teamIdsByKey(db, leagueId);
  if (teamIds.size === 0) return;

  const { error: clearError } = await db
    .from("rosters")
    .delete()
    .in("team_id", [...teamIds.values()]);

  if (clearError) throw new Error(`Failed to clear rosters: ${clearError.message}`);

  const rows = new Map<string, Database["public"]["Tables"]["rosters"]["Insert"]>();

  for (const entry of pool) {
    if (!entry.teamKey) continue;
    const teamId = teamIds.get(entry.teamKey);
    if (!teamId) continue;

    const resolution = resolved.get(entry.yahooPlayerId);
    if (!resolution) continue;

    rows.set(`${teamId}:${resolution.playerId}`, {
      team_id: teamId,
      player_id: resolution.playerId,
      slot: entry.player.selectedPosition,
      is_starter: entry.player.isStarter,
      yahoo_player_id: entry.yahooPlayerId,
    });
  }

  for (const batch of chunk([...rows.values()], INSERT_CHUNK)) {
    const { error } = await db
      .from("rosters")
      .upsert(batch, { onConflict: "team_id,player_id" });

    if (error) throw new Error(`Failed to save rosters: ${error.message}`);
  }
}

function toPayload(entry: PoolEntry): UnmatchedPayload {
  return {
    playerKey: entry.player.playerKey,
    name: entry.player.name,
    position: entry.player.position,
    nflTeam: entry.player.nflTeam,
    isDefense: entry.player.isDefense,
    status: entry.player.status,
    teamKey: entry.teamKey,
    slot: entry.player.selectedPosition,
    isStarter: entry.player.isStarter,
  };
}

/**
 * Every miss is written down — §13's rule is that an unresolved player must
 * appear in `unmatched_players`, never be silently dropped. Rows resolved
 * since the last run are closed out rather than deleted, so the admin screen
 * keeps a record of what it fixed.
 */
async function writeUnmatched(
  db: Db,
  leagueId: string,
  unresolved: PoolEntry[],
  resolved: Map<string, Resolution>,
) {
  if (unresolved.length > 0) {
    const rows = unresolved.map((entry) => ({
      league_id: leagueId,
      yahoo_player_id: entry.yahooPlayerId,
      payload: toPayload(entry) as unknown as Json,
      resolved_at: null,
      resolved_player_id: null,
    }));

    for (const batch of chunk(rows, INSERT_CHUNK)) {
      const { error } = await db
        .from("unmatched_players")
        .upsert(batch, { onConflict: "league_id,yahoo_player_id" });

      if (error) throw new Error(`Failed to save unmatched: ${error.message}`);
    }
  }

  const { data: pending, error } = await db
    .from("unmatched_players")
    .select("id, yahoo_player_id")
    .eq("league_id", leagueId)
    .is("resolved_at", null);

  if (error) throw new Error(`Failed to read unmatched: ${error.message}`);

  const now = new Date().toISOString();
  for (const row of pending ?? []) {
    const resolution = resolved.get(row.yahoo_player_id);
    if (!resolution) continue;

    await db
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

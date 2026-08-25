import "server-only";

import { fetchAllPlayers, type SleeperPlayer } from "@/lib/sources/sleeper";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type Admin = ReturnType<typeof createAdminClient>;

/** §3: the 14.6 MB Sleeper player master is refreshed at most once a day. */
export const PLAYER_MASTER_TTL_MS = 24 * 60 * 60 * 1000;

/** PostgREST caps a page at 1000 rows; keep reads and writes under it. */
export const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 500;

export type PlayerRow = {
  id: number;
  sleeper_id: string | null;
  full_name: string;
  search_name: string;
  position: string | null;
  nfl_team: string | null;
  birth_date: string | null;
  injury_status: string | null;
};

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Reads a whole table past PostgREST's 1000-row page cap. */
export async function loadPlayers(admin: Admin): Promise<PlayerRow[]> {
  const rows: PlayerRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from("players")
      .select(
        "id, sleeper_id, full_name, search_name, position, nfl_team, birth_date, injury_status",
      )
      .order("id")
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to read players: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

function toRow(player: SleeperPlayer): Database["public"]["Tables"]["players"]["Insert"] {
  return {
    sleeper_id: player.sleeperId,
    full_name: player.fullName,
    search_name: player.searchName,
    position: player.position,
    nfl_team: player.nflTeam,
    age: player.age,
    years_exp: player.yearsExp,
    status: player.status,
    injury_status: player.injuryStatus,
    birth_date: player.birthDate,
    // Sleeper serves headshots off a predictable CDN path rather than shipping
    // a URL in the payload.
    headshot_url: `https://sleepercdn.com/content/nfl/players/${player.sleeperId}.jpg`,
  };
}

export type PlayerMasterResult = {
  /** False when the cached master was still inside its TTL. */
  refreshed: boolean;
  count: number;
  /** The freshly fetched rows — present only on a refresh, for the seeders. */
  players: SleeperPlayer[] | null;
};

/**
 * Pulls Sleeper's player master into `players`. Written by the service role —
 * this is global reference data, not user data (§8).
 */
export async function syncPlayerMaster(
  { force = false }: { force?: boolean } = {},
): Promise<PlayerMasterResult> {
  const admin = createAdminClient();

  const [{ data: newest }, { count }] = await Promise.all([
    admin
      .from("players")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("players").select("id", { count: "exact", head: true }),
  ]);

  const age = newest ? Date.now() - Date.parse(newest.updated_at) : Infinity;
  if (!force && age < PLAYER_MASTER_TTL_MS) {
    return { refreshed: false, count: count ?? 0, players: null };
  }

  const players = await fetchAllPlayers();

  for (const batch of chunk(players, UPSERT_CHUNK)) {
    const { error } = await admin
      .from("players")
      .upsert(batch.map(toRow), { onConflict: "sleeper_id" });

    if (error) throw new Error(`Failed to save players: ${error.message}`);
  }

  return { refreshed: true, count: players.length, players };
}

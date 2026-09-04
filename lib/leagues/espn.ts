import "server-only";

import { saveLeague, type ImportResult } from "@/lib/leagues/import";
import {
  fetchEspnLeague,
  parseEspnLeagueKey,
  type EspnLeagueRef,
} from "@/lib/sources/espn";
import { getEspnSwid } from "@/lib/sources/espn-auth";
import type { Db } from "@/lib/supabase/db";

/**
 * Writing a league read from ESPN.
 *
 * Thin on purpose. `saveLeague` already knows how to land a league and its
 * teams; what is here is the two things that are actually different about
 * ESPN — the league is named by an id and a season rather than by a key the
 * provider hands out, and the payload only knows which team is yours if it was
 * read with your cookies.
 */

export function isEspnLeague(source: string | null | undefined): boolean {
  return source === "espn";
}

/**
 * The ref a stored league row points at.
 *
 * Throws rather than returning null: every caller reaching for this has
 * already established the row is an ESPN league, so a key that will not parse
 * is a corrupted row, not a branch to handle.
 */
export function refOf(league: {
  yahoo_league_key: string;
  season: number;
}): EspnLeagueRef {
  const ref = parseEspnLeagueKey(league.yahoo_league_key);
  if (!ref) {
    throw new Error(
      `This league is marked as an ESPN league but its key (${league.yahoo_league_key}) is not one.`,
    );
  }
  return ref;
}

/**
 * Pulls a league from ESPN and writes it.
 *
 * Idempotent on the derived key, so connecting the same league twice — or
 * sync stage 6 running for the hundredth time — refreshes one board rather
 * than opening another.
 */
export async function importEspnLeague(
  db: Db,
  userId: string,
  ref: EspnLeagueRef,
): Promise<ImportResult & { knowsUsersTeam: boolean }> {
  const swid = await getEspnSwid(userId);
  const { league, teams, knowsUsersTeam } = await fetchEspnLeague(
    userId,
    ref,
    swid,
  );

  if (teams.length === 0) {
    throw new Error(
      "ESPN returned no teams for that league. If it is private, add your SWID and espn_s2 cookies.",
    );
  }

  const result = await saveLeague(
    db,
    userId,
    { league, teams },
    // A read without cookies cannot know whose team is whose, and writing
    // `false` for all twelve on every sync would quietly undo the choice the
    // user made on the board.
    { source: "espn", writeUsersTeam: knowsUsersTeam },
  );

  return { ...result, knowsUsersTeam };
}

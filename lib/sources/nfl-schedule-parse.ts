import { z } from "zod";

import { normalizeTeam } from "@/lib/crosswalk/resolve";

/**
 * Sleeper's season schedule, as a pure parse.
 *
 * The endpoint is `/schedule/nfl/regular/{season}` -- note the missing `/v1`,
 * which is the only path in this app that sits outside it. It answers one
 * object per game: `{ week, date, home, away, game_id, status }`.
 *
 * A game is turned into *two* rows here, one per team, because every question
 * downstream is "who does this team play in week N" rather than "who played in
 * this game". A bye is then simply a team with no row for that week, which is
 * the same way the weekly stat grid already says "no game".
 */

const GameSchema = z.object({
  week: z.number().int(),
  home: z.string().nullable().optional(),
  away: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

export type ScheduleRow = {
  week: number;
  team: string;
  opponent: string;
  isHome: boolean;
  /** Kickoff day, `YYYY-MM-DD`, or null when Sleeper has not placed it yet. */
  kickoff: string | null;
};

/** A game Sleeper has struck from the slate is not a game anybody plays. */
const CANCELLED = new Set(["canceled", "cancelled", "postponed"]);

export function parseNflSchedule(payload: unknown): ScheduleRow[] {
  const games = z.array(GameSchema).catch([]).parse(payload);
  const rows: ScheduleRow[] = [];

  for (const game of games) {
    const status = (game.status ?? "").toLowerCase();
    if (CANCELLED.has(status)) continue;

    const home = normalizeTeam(game.home);
    const away = normalizeTeam(game.away);
    // Sleeper publishes the following season's slate before both sides of
    // every game are known. Half a game is not a matchup, so it is dropped
    // rather than written with a placeholder opponent.
    if (!home || !away || home === away) continue;
    if (game.week < 1 || game.week > 18) continue;

    const kickoff = game.date && /^\d{4}-\d{2}-\d{2}$/.test(game.date)
      ? game.date
      : null;

    rows.push({ week: game.week, team: home, opponent: away, isHome: true, kickoff });
    rows.push({ week: game.week, team: away, opponent: home, isHome: false, kickoff });
  }

  return rows;
}

import "server-only";

import {
  SleeperStateSchema,
  parseSleeperPlayers,
  parseStatMap,
  type SleeperPlayer,
  type SleeperState,
  type StatLine,
} from "./sleeper-parse";

export { gamesPlayed, hasScoring, scoredPoints } from "./sleeper-parse";
export type { SleeperPlayer, SleeperState, StatLine } from "./sleeper-parse";

const API_BASE = "https://api.sleeper.app/v1";

export class SleeperApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SleeperApiError";
  }
}

async function get(path: string) {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new SleeperApiError(
      `Sleeper request failed (${response.status}) for ${path}`,
      response.status,
    );
  }
  return response.json();
}

/** Season/week clock. Preseason means "current season stats" will be empty (§0). */
export async function fetchNflState(): Promise<SleeperState> {
  return SleeperStateSchema.parse(await get("/state/nfl"));
}

/**
 * The full player master, 14.6 MB. Cache with a >=24h TTL (§3) — this is
 * expensive on both ends and player identity barely changes day to day.
 */
export async function fetchAllPlayers(): Promise<SleeperPlayer[]> {
  return parseSleeperPlayers(await get("/players/nfl"));
}

/**
 * §3 writes the weekly endpoints as `/{kind}/nfl/{season}/{week}`. Measured
 * against the live API that path is real but useless: it answers 200 with a
 * body of rank-only stubs — 7,627 entries, not one of them carrying a single
 * scoring key. The season-type segment is what makes a week's payload actual
 * stats, and it is required on the weekly form exactly as it is on the season
 * one. Checked on 2026 week 1 projections: `/projections/nfl/2026/1` returns
 * 943 empty objects, `/projections/nfl/regular/2026/1` returns those same 943
 * players with `pts_ppr` on every one.
 */
function statPath(kind: "stats" | "projections", season: number, week?: number) {
  const base = `/${kind}/nfl/regular/${season}`;
  return week === undefined ? base : `${base}/${week}`;
}

/** Season totals (`week: 0`) or a specific week's actuals. */
export async function fetchStats(
  season: number,
  week?: number,
): Promise<StatLine[]> {
  return parseStatMap(await get(statPath("stats", season, week)));
}

/** Season totals (`week: 0`) or a specific week's projections. */
export async function fetchProjections(
  season: number,
  week?: number,
): Promise<StatLine[]> {
  return parseStatMap(await get(statPath("projections", season, week)));
}

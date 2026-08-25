import "server-only";

import {
  SleeperStateSchema,
  parseSleeperPlayers,
  parseStatMap,
  type SleeperPlayer,
  type SleeperState,
  type StatLine,
} from "./sleeper-parse";

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

/** Season totals (`week: 0`) or a specific week's actuals. */
export async function fetchStats(
  season: number,
  week?: number,
): Promise<StatLine[]> {
  const path =
    week === undefined
      ? `/stats/nfl/regular/${season}`
      : `/stats/nfl/${season}/${week}`;
  return parseStatMap(await get(path));
}

/** Season totals (`week: 0`) or a specific week's projections. */
export async function fetchProjections(
  season: number,
  week?: number,
): Promise<StatLine[]> {
  const path =
    week === undefined
      ? `/projections/nfl/regular/${season}`
      : `/projections/nfl/${season}/${week}`;
  return parseStatMap(await get(path));
}

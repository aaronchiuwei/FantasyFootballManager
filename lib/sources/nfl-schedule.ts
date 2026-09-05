import "server-only";

import { parseNflSchedule, type ScheduleRow } from "./nfl-schedule-parse";

export type { ScheduleRow } from "./nfl-schedule-parse";

/**
 * The one Sleeper path that is not under `/v1`. Checked against the live API:
 * `/schedule/nfl/regular/2026` answers 273 games across weeks 1-18 for all 32
 * teams, roughly 27 KB.
 */
const SCHEDULE_URL = (season: number) =>
  `https://api.sleeper.app/schedule/nfl/regular/${season}`;

export class NflScheduleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NflScheduleError";
  }
}

/** One season's slate, two rows per game. Empty for a season Sleeper has not published. */
export async function fetchNflSchedule(season: number): Promise<ScheduleRow[]> {
  const response = await fetch(SCHEDULE_URL(season), { cache: "no-store" });

  // A season with no schedule yet is a fact, not a failure: the current
  // season's slate appears months before it is played and a prior season's
  // never disappears, so the only 404 this can produce is "not published".
  if (response.status === 404) return [];

  if (!response.ok) {
    throw new NflScheduleError(
      `Sleeper schedule fetch failed (${response.status}) for ${season}`,
      response.status,
    );
  }

  return parseNflSchedule(await response.json());
}

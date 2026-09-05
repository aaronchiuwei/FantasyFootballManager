import "server-only";

import { parseWeeklyScoring, type PositionScoring } from "./nflverse-parse";

export type { PositionScoring, GradedPosition } from "./nflverse-parse";
export { GRADED_POSITIONS } from "./nflverse-parse";

/**
 * nflverse publishes one weekly player-stats file per season as a GitHub
 * release asset. The gzipped form is 1.2 MB against the plain CSV's 8.6 MB and
 * decompresses in the runtime, so it is the one fetched.
 *
 * The same shape the DynastyProcess crosswalk is already read in: a public
 * file over https, no key, parsed by a pure function.
 */
const WEEKLY_URL = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv.gz`;

export class NflverseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "NflverseError";
  }
}

async function gunzip(response: Response): Promise<string> {
  if (!response.body) return "";
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * One season's per-team, per-position scoring totals.
 *
 * A season with no file is an empty array rather than a throw: nflverse
 * publishes a season's file after its first games, so the current season 404s
 * every year until Week 1 is in the books. That is the state the app is
 * usually in when someone first opens it, and it is not an error -- it is what
 * makes the prior season the whole answer for a while.
 */
export async function fetchSeasonScoring(
  season: number,
): Promise<PositionScoring[]> {
  const response = await fetch(WEEKLY_URL(season), { cache: "no-store" });

  if (response.status === 404) return [];

  if (!response.ok) {
    throw new NflverseError(
      `nflverse weekly stats fetch failed (${response.status}) for ${season}`,
      response.status,
    );
  }

  return parseWeeklyScoring(await gunzip(response));
}

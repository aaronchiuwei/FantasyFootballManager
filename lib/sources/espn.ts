import "server-only";

import { EspnAuthRequired, getEspnCookies, markEspnNeedsReauth } from "./espn-auth";
import {
  parseEspnFreeAgents,
  parseEspnLeague,
  parseEspnMatchups,
  parseEspnRosters,
  type EspnLeagueImport,
  type EspnLeagueRef,
  type EspnPlayer,
} from "./espn-parse";

export {
  espnLeagueKey,
  espnLeagueUrl,
  espnTeamKey,
  isEspnLeagueKey,
  normalizeSwid,
  parseEspnLeagueKey,
} from "./espn-parse";
export type { EspnLeagueImport, EspnLeagueRef, EspnPlayer } from "./espn-parse";
export { EspnAuthRequired } from "./espn-auth";

/**
 * The read-only mirror ESPN's own site calls. `lm-api-reads` is the host that
 * answers league reads without a session for a public league; the `fantasy`
 * host in front of it does not always.
 */
const API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

export class EspnApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "EspnApiError";
  }
}

export class EspnLeagueNotFound extends EspnApiError {
  constructor(ref: EspnLeagueRef) {
    super(
      `ESPN has no league ${ref.leagueId} for ${ref.season}. Check the league id and the season on the league's URL.`,
      404,
    );
    this.name = "EspnLeagueNotFound";
  }
}

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

type RequestOptions = {
  views: string[];
  /** ESPN's own query language, for the free-agent filter. */
  filter?: unknown;
  scoringPeriodId?: number;
};

function urlsFor(ref: EspnLeagueRef, options: RequestOptions): string[] {
  const params = new URLSearchParams();
  for (const view of options.views) params.append("view", view);
  if (options.scoringPeriodId !== undefined) {
    params.set("scoringPeriodId", String(options.scoringPeriodId));
  }

  const id = encodeURIComponent(ref.leagueId);
  const query = params.toString();

  // Two shapes, tried in order. The first is where a league for the current
  // (or a recent) season lives. The second is ESPN's archive, which is the
  // only place an older season answers from — and it answers with a
  // one-element array, which the parsers unwrap.
  return [
    `${API_BASE}/seasons/${ref.season}/segments/0/leagues/${id}?${query}`,
    `${API_BASE}/leagueHistory/${id}?seasonId=${ref.season}&${query}`,
  ];
}

function cookieHeader(cookies: { swid: string; espnS2: string } | null) {
  if (!cookies) return undefined;
  const swid = cookies.swid.startsWith("{") ? cookies.swid : `{${cookies.swid}}`;
  return `SWID=${swid}; espn_s2=${encodeURIComponent(cookies.espnS2)}`;
}

/**
 * GETs an ESPN league resource as the user.
 *
 * Cookies are attached whenever the user has stored a pair, even for a public
 * league — they cost nothing there and they are the only way the payload can
 * say which team is theirs.
 *
 * A 401 is the private-league answer and it means exactly one thing: the pair
 * is missing or dead. It is turned into `EspnAuthRequired` and the stored pair
 * is flagged, so the UI asks for a fresh paste instead of failing syncs
 * silently. A 404 on both URL shapes means the league id or the season is
 * wrong, which is a different mistake and gets its own message.
 */
export async function espnGet(
  userId: string,
  ref: EspnLeagueRef,
  options: RequestOptions,
): Promise<unknown> {
  const cookies = await getEspnCookies(userId);
  const cookie = cookieHeader(cookies);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (options.filter !== undefined) {
    headers["x-fantasy-filter"] = JSON.stringify(options.filter);
  }

  let lastStatus = 0;
  let lastBody = "";

  for (const url of urlsFor(ref, options)) {
    let response = await fetch(url, { headers, cache: "no-store" });

    // Undocumented rate limits, same as Yahoo's. One backed-off retry.
    if (response.status === 429 || response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      response = await fetch(url, { headers, cache: "no-store" });
    }

    if (response.ok) return response.json();

    if (response.status === 401 || response.status === 403) {
      if (cookies) await markEspnNeedsReauth(userId);
      throw new EspnAuthRequired(
        cookies
          ? "ESPN turned down the stored cookies. Paste a fresh SWID and espn_s2 to keep reading this league."
          : "This ESPN league is private. Add your SWID and espn_s2 cookies to read it.",
      );
    }

    lastStatus = response.status;
    lastBody = await response.text();
    // 404 on the season path is normal for an older league — try the archive.
    if (response.status !== 404) break;
  }

  if (lastStatus === 404) throw new EspnLeagueNotFound(ref);

  throw new EspnApiError(
    `ESPN request failed (${lastStatus}) for league ${ref.leagueId}: ${lastBody.slice(0, 300)}`,
    lastStatus,
  );
}

// ---------------------------------------------------------------------------
// resources
// ---------------------------------------------------------------------------

/**
 * Settings, standings and teams in one request — ESPN composes views the way
 * Yahoo composes `;out=`, so this is one round trip rather than three (§3).
 */
export async function fetchEspnLeague(
  userId: string,
  ref: EspnLeagueRef,
  swid: string | null,
): Promise<EspnLeagueImport> {
  return parseEspnLeague(
    await espnGet(userId, ref, { views: ["mSettings", "mTeam"] }),
    ref,
    swid,
  );
}

/** Every team's roster in one call. */
export async function fetchEspnRosters(userId: string, ref: EspnLeagueRef) {
  return parseEspnRosters(
    await espnGet(userId, ref, { views: ["mRoster", "mTeam"] }),
    ref,
  );
}

/**
 * The top available players by how widely they are rostered.
 *
 * ESPN takes the whole request as one `x-fantasy-filter` header and answers it
 * in a single response, so unlike Yahoo's 25-at-a-time pagination this is one
 * call for the lot. The cap is the same ~150 the waiver board reads (§3).
 */
export async function fetchEspnFreeAgents(
  userId: string,
  ref: EspnLeagueRef,
  { limit = 150 }: { limit?: number } = {},
): Promise<EspnPlayer[]> {
  const payload = await espnGet(userId, ref, {
    views: ["kona_player_info"],
    filter: {
      players: {
        filterStatus: { value: ["FREEAGENT", "WAIVERS"] },
        limit,
        sortPercOwned: { sortAsc: false, sortPriority: 1 },
      },
    },
  });

  return parseEspnFreeAgents(payload).slice(0, limit);
}

/**
 * The schedule and its scores.
 *
 * ESPN sends the whole season whatever it is asked for, so the weeks are a
 * filter applied to one response rather than a reason to make several.
 */
export async function fetchEspnMatchups(
  userId: string,
  ref: EspnLeagueRef,
  weeks: number[],
) {
  if (weeks.length === 0) return [];

  return parseEspnMatchups(
    await espnGet(userId, ref, { views: ["mMatchup", "mTeam"] }),
    ref,
    weeks,
  );
}

/**
 * One cheap request that answers "can this league be read at all".
 *
 * Sync's preflight (§9) exists so a league that cannot finish says so before
 * it spends a minute on Sleeper, FantasyCalc and two seasons of stat lines.
 * For Yahoo that is a token lookup; ESPN has no such local answer, because
 * whether a league needs cookies is a fact about the league rather than about
 * the account. So it is asked, with the smallest view ESPN offers.
 */
export async function probeEspnLeague(
  userId: string,
  ref: EspnLeagueRef,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await espnGet(userId, ref, { views: ["mSettings"] });
    return { ok: true };
  } catch (cause) {
    if (cause instanceof EspnAuthRequired || cause instanceof EspnApiError) {
      return { ok: false, reason: cause.message };
    }
    return {
      ok: false,
      reason:
        cause instanceof Error ? cause.message : "Could not reach ESPN.",
    };
  }
}

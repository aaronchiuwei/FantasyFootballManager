import "server-only";

import { getAccessToken, YahooReauthRequired } from "./yahoo-auth";
import { isPlainObject, normalize, type Plain } from "./yahoo-json";
import { parseDiscovery, parseLeague } from "./yahoo-parse";

const API_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

// ---------------------------------------------------------------------------
// transport
// ---------------------------------------------------------------------------

export class YahooApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "YahooApiError";
  }
}

async function request(path: string, accessToken: string) {
  const separator = path.includes("?") ? "&" : "?";
  return fetch(`${API_BASE}/${path}${separator}format=json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
}

/**
 * GETs a Yahoo Fantasy resource and returns its normalized `fantasy_content`.
 *
 * A 401 mid-flight means the access token died early; refresh once and retry.
 * Rate limits are undocumented, so 429/5xx get one backed-off retry too.
 */
export async function yahooGet(userId: string, path: string): Promise<Plain> {
  let accessToken = await getAccessToken(userId);
  let response = await request(path, accessToken);

  if (response.status === 401) {
    accessToken = await getAccessToken(userId, { forceRefresh: true });
    response = await request(path, accessToken);
  }

  if (response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    response = await request(path, accessToken);
  }

  if (response.status === 401) {
    throw new YahooReauthRequired("Yahoo rejected the access token");
  }

  if (!response.ok) {
    const body = await response.text();
    throw new YahooApiError(
      `Yahoo request failed (${response.status}) for ${path}: ${body.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = normalize(await response.json());
  if (!isPlainObject(payload) || !isPlainObject(payload.fantasy_content)) {
    throw new YahooApiError(`Unexpected Yahoo payload for ${path}`, 200);
  }

  return payload.fantasy_content;
}

// ---------------------------------------------------------------------------
// resources
// ---------------------------------------------------------------------------

export type {
  DiscoveredLeague,
  LeagueImport,
  RosterSlot,
  TeamImport,
  YahooDiscovery,
} from "./yahoo-parse";

/** Every NFL league the signed-in Yahoo account belongs to this season. */
export async function discoverLeagues(userId: string) {
  return parseDiscovery(
    await yahooGet(userId, "users;use_login=1/games;game_keys=nfl/leagues"),
  );
}

/**
 * One request for settings, standings and teams — Yahoo's `;out=` composition
 * collapses three round trips into one, which matters given undocumented rate
 * limits (§3).
 */
export async function fetchLeague(userId: string, leagueKey: string) {
  return parseLeague(
    await yahooGet(
      userId,
      `league/${encodeURIComponent(leagueKey)};out=settings,standings,teams`,
    ),
  );
}

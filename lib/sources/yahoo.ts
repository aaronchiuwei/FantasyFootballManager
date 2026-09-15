import "server-only";

import { getAccessToken, YahooReauthRequired } from "./yahoo-auth";
import { isPlainObject, normalize, type Plain } from "./yahoo-json";
import {
  parseDiscovery,
  parseLeague,
  parseMatchups,
  parsePlayerList,
  parseRosters,
  type MatchupImport,
  type YahooPlayer,
} from "./yahoo-parse";

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

/**
 * A 401 that survived a *successful* token refresh.
 *
 * The link cannot be expired — Yahoo minted a token for it moments ago — so
 * this is about what the grant is allowed to read, not about the credential.
 * Calling it an expired link sends the user round the consent screen again and
 * lands them back here, which is the loop this class exists to break: the
 * grant carries no Fantasy Sports scope at all.
 */
export class YahooAccessDenied extends YahooApiError {
  constructor(detail: string) {
    super(
      "Yahoo refused to read your fantasy leagues with a token it had just " +
        "issued, so the link itself is fine — the grant it carries has no " +
        "Fantasy Sports read scope on it. That is settled on the Yahoo app " +
        "rather than here, and since Yahoo closed self-serve access to this " +
        "API in 2026 it is their review team that grants it, at " +
        "sports.yahoo.com/developer/access, rather than a checkbox on the " +
        "app's registration." +
        (detail ? ` Yahoo said: ${detail}` : ""),
      401,
    );
    this.name = "YahooAccessDenied";
  }
}

/**
 * A 403 from the Fantasy API: Yahoo knows the app and refuses it outright.
 *
 * Distinct from `YahooAccessDenied` in what it says about the grant. A 401
 * means the token was let in and found wanting; a 403 is refused at the door,
 * identically for a public resource and a private one, so it is the *app* being
 * turned away rather than anything the user consented to.
 *
 * Yahoo closed self-serve access to the Fantasy Sports API in 2026 — the
 * permission left the registration form and apps that still held it began
 * being refused in July — and approval is now granted per app by review. That
 * makes reconnecting actively misleading advice here: the consent screen still
 * appears, still grants the scope, and the API still answers 403.
 */
export class YahooAppNotApproved extends YahooApiError {
  constructor(detail: string) {
    super(
      "Yahoo will not serve the Fantasy Sports API to this app. Your link is " +
        "not the problem — the token, the consent and the scope are all in " +
        "order — so reconnecting will not shift it. Yahoo closed self-serve " +
        "access to this API in 2026 and now approves each app by review: apply " +
        "at sports.yahoo.com/developer/access, quoting the app's ID. Until " +
        "that approval comes through, a league can still come from ESPN or be " +
        "set up by hand." +
        (detail ? ` Yahoo said: ${detail}` : ""),
      403,
    );
    this.name = "YahooAppNotApproved";
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
 * A 401 mid-flight is ambiguous: the access token may have died early, or
 * Yahoo may be refusing this resource whatever token it is shown. Forcing a
 * refresh settles which — if Yahoo hands back a new token the credential is
 * alive, so a second 401 is a permission and must not be reported as an
 * expired link (§12). A refresh Yahoo *rejects* raises `YahooReauthRequired`
 * from `getAccessToken` itself, which is the real re-link prompt.
 *
 * Rate limits are undocumented, so 429/5xx get one backed-off retry too.
 */
export async function yahooGet(userId: string, path: string): Promise<Plain> {
  let accessToken = await getAccessToken(userId);
  let response = await request(path, accessToken);
  let refreshed = false;

  if (response.status === 401) {
    accessToken = await getAccessToken(userId, { forceRefresh: true });
    refreshed = true;
    response = await request(path, accessToken);
  }

  if (response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    response = await request(path, accessToken);
  }

  if (response.status === 401) {
    const body = await response.text();
    // Only reachable without a refresh when the backed-off retry above turned
    // a 429/5xx into a 401, which leaves the token genuinely unproven.
    throw refreshed
      ? new YahooAccessDenied(body.slice(0, 200))
      : new YahooReauthRequired("Yahoo rejected the access token");
  }

  // Refused at the door rather than let in and found wanting. No token this
  // app can present will change the answer, so this must not fall through to
  // the generic failure below and read as something a retry might fix.
  if (response.status === 403) {
    throw new YahooAppNotApproved((await response.text()).slice(0, 200));
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
  MatchupImport,
  RosterSlot,
  TeamImport,
  TeamRoster,
  YahooDiscovery,
  YahooPlayer,
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

/** Every team's roster in one call — `;out=roster` on the teams collection. */
export async function fetchRosters(userId: string, leagueKey: string) {
  return parseRosters(
    await yahooGet(
      userId,
      `league/${encodeURIComponent(leagueKey)}/teams;out=roster`,
    ),
  );
}

/** Yahoo caps a players page at 25. */
const FA_PAGE_SIZE = 25;

/**
 * The top available players by Yahoo's own rank. Pagination is the only
 * unavoidably chatty Yahoo call, so it is capped at ~150 — far more than any
 * waiver recommendation needs (§3).
 */
export async function fetchFreeAgents(
  userId: string,
  leagueKey: string,
  { limit = 150 }: { limit?: number } = {},
) {
  const key = encodeURIComponent(leagueKey);
  const players: YahooPlayer[] = [];

  for (let start = 0; start < limit; start += FA_PAGE_SIZE) {
    const page = parsePlayerList(
      await yahooGet(
        userId,
        `league/${key}/players;status=A;sort=OR;start=${start};count=${FA_PAGE_SIZE}`,
      ),
    );

    players.push(...page);
    if (page.length < FA_PAGE_SIZE) break;
  }

  return players.slice(0, limit);
}

/** Weeks per scoreboard request. Yahoo takes a comma list; this keeps it sane. */
const SCOREBOARD_CHUNK = 6;

/**
 * The schedule and its scores, for the weeks given.
 *
 * Yahoo will return every week in one `;week=` list, but a full season of
 * matchups in a single response is a payload with no ceiling we control, so it
 * is asked for in chunks — still a handful of requests rather than one per
 * week (§3).
 */
export async function fetchMatchups(
  userId: string,
  leagueKey: string,
  weeks: number[],
): Promise<MatchupImport[]> {
  const key = encodeURIComponent(leagueKey);
  const matchups: MatchupImport[] = [];

  for (let i = 0; i < weeks.length; i += SCOREBOARD_CHUNK) {
    const batch = weeks.slice(i, i + SCOREBOARD_CHUNK);
    matchups.push(
      ...parseMatchups(
        await yahooGet(userId, `league/${key}/scoreboard;week=${batch.join(",")}`),
      ),
    );
  }

  return matchups;
}

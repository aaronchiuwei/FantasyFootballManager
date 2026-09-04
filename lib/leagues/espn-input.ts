/**
 * What an ESPN league looks like on the way in.
 *
 * Pure, and separate from the writes for the same reason `manual-input.ts` is:
 * the interesting part is the reading. Everything a person can paste into the
 * connect form is turned into an `EspnLeagueRef` and, when the league is
 * private, a cookie pair — or into one sentence saying what to fix.
 */
import { z } from "zod";

import type { EspnLeagueRef } from "@/lib/sources/espn-parse";
import type { Planned } from "./manual-input";

export type EspnConnectPlan = {
  ref: EspnLeagueRef;
  /** Null when the form left the cookie boxes empty — a public league. */
  cookies: { swid: string; espnS2: string } | null;
};

/**
 * The seasons a form may name.
 *
 * The floor is where ESPN's v3 API starts answering; the ceiling is next year,
 * because a league is created for a season before that season starts.
 */
export const FIRST_ESPN_SEASON = 2018;

export function latestEspnSeason(now = new Date()): number {
  // A fantasy season is named for the calendar year it kicks off in, and ESPN
  // opens the next one during the summer. January through July still belongs
  // to the season that just ended as far as "what can I connect" goes.
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/**
 * The league id out of anything ESPN puts one in.
 *
 * People paste the URL, because the URL is where the number is. Accepting it
 * costs one regex and removes the single most likely way to get this wrong —
 * and a bare id is still just an id.
 */
export function parseEspnLeagueId(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  if (/^\d{1,20}$/.test(value)) return value;

  const fromQuery = /[?&]leagueId=(\d{1,20})/i.exec(value);
  if (fromQuery) return fromQuery[1];

  // The newer app URLs put it in the path: /football/team?leagueId=… is the
  // common one, but /football/league/12345 shows up too.
  const fromPath = /\/(?:league|team)\/(\d{1,20})(?:[/?#]|$)/i.exec(value);
  if (fromPath) return fromPath[1];

  return null;
}

/** The season out of a pasted URL, when it carries one. */
export function parseEspnSeason(raw: string): number | null {
  const match = /[?&]seasonId=(\d{4})/i.exec(raw);
  return match ? Number(match[1]) : null;
}

/**
 * ESPN writes the account id in braces and people paste it both ways. Stored
 * braced, because that is the form the cookie header wants back.
 */
function tidySwid(raw: string): string {
  const bare = raw.trim().replace(/^\{|\}$/g, "");
  return `{${bare}}`;
}

const connectSchema = z.object({
  leagueId: z.string().default(""),
  season: z.coerce.number().int().optional(),
  swid: z.string().default(""),
  espnS2: z.string().default(""),
});

/**
 * Reads the connect form.
 *
 * The cookies are optional as a pair and only as a pair: half of one is not a
 * private-league login, it is a typo, and finding that out here is better than
 * finding it out as a 401 two screens later.
 */
export function planEspnConnect(
  raw: unknown,
  now = new Date(),
): Planned<EspnConnectPlan> {
  const parsed = connectSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Check the form." };

  const leagueId = parseEspnLeagueId(parsed.data.leagueId);
  if (!leagueId) {
    return {
      ok: false,
      error:
        "That is not an ESPN league id. Paste the number, or the whole league URL.",
    };
  }

  const season =
    parsed.data.season ??
    parseEspnSeason(parsed.data.leagueId) ??
    latestEspnSeason(now);

  if (season < FIRST_ESPN_SEASON || season > latestEspnSeason(now) + 1) {
    return {
      ok: false,
      error: `Pick a season between ${FIRST_ESPN_SEASON} and ${latestEspnSeason(now) + 1}.`,
    };
  }

  const swid = parsed.data.swid.trim();
  const espnS2 = parsed.data.espnS2.trim();

  if (Boolean(swid) !== Boolean(espnS2)) {
    return {
      ok: false,
      error:
        "A private league needs both cookies. Add the missing one, or clear both for a public league.",
    };
  }

  return {
    ok: true,
    plan: {
      ref: { leagueId, season },
      cookies: swid && espnS2 ? { swid: tidySwid(swid), espnS2 } : null,
    },
  };
}

/** Pure parsers for Sleeper payloads. No transport, so fixture-testable. */
import { z } from "zod";

import { normalizeName } from "./name-normalize";

export const SleeperStateSchema = z.object({
  week: z.number(),
  season: z.string(),
  season_type: z.enum(["pre", "regular", "post", "off"]),
  display_week: z.number(),
  // The season whose actuals are the honest preseason context (§12). Optional
  // because it is undocumented like the rest of Sleeper — the caller falls back
  // to `season - 1`, which is what it means anyway.
  previous_season: z.string().nullish(),
});

export type SleeperState = z.infer<typeof SleeperStateSchema>;

const SleeperPlayerSchema = z.object({
  player_id: z.string(),
  full_name: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  search_full_name: z.string().nullish(),
  position: z.string().nullish(),
  fantasy_positions: z.array(z.string()).nullish(),
  team: z.string().nullish(),
  age: z.number().nullish(),
  years_exp: z.number().nullish(),
  status: z.string().nullish(),
  injury_status: z.string().nullish(),
  yahoo_id: z.union([z.string(), z.number()]).nullish(),
  espn_id: z.union([z.string(), z.number()]).nullish(),
  birth_date: z.string().nullish(),
  active: z.boolean().nullish(),
});

export type SleeperPlayer = {
  sleeperId: string;
  fullName: string;
  searchName: string;
  position: string | null;
  nflTeam: string | null;
  age: number | null;
  yearsExp: number | null;
  status: string | null;
  injuryStatus: string | null;
  yahooId: string | null;
  espnId: string | null;
  birthDate: string | null;
  active: boolean;
};

/**
 * Sleeper's player master is a giant object keyed by player_id, including
 * thousands of retired/practice-squad entries irrelevant to fantasy. We keep
 * only players with a resolvable name and a fantasy-relevant position — the
 * full 14.6 MB payload otherwise floods the players table for no benefit.
 */
const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

/**
 * Sleeper's aliases for the six positions this app scores.
 *
 * Kept here rather than imported from the crosswalk's `normalizePosition` so
 * the parsers stay free of the resolver: this is a *source* concern — what
 * Sleeper calls a position — and the crosswalk's job is comparing two sources
 * that already agree on vocabulary.
 *
 * `FB` is the one that matters. Sleeper lists a fullback's `position` as FB and
 * his `fantasy_positions` as `["RB"]`, which is Sleeper telling us plainly that
 * he is a running back for fantasy purposes.
 */
const POSITION_ALIASES: Record<string, string> = {
  FB: "RB",
  HB: "RB",
  DST: "DEF",
  "D/ST": "DEF",
  PK: "K",
};

/**
 * The position this player occupies in a fantasy lineup, or null if none.
 *
 * Every label the payload offers is considered, aliases resolved, and the
 * first fantasy-relevant one wins. Reading `position` alone and giving up was
 * a real omission rather than a nicety: Kyle Juszczyk is `FB` / `["RB"]`, so
 * he was dropped from the master entirely — which meant a league that rostered
 * him could never resolve him, and the identity screen offered five other
 * people because the right answer was not in the table to offer.
 */
function fantasyPosition(
  position: string | null | undefined,
  fantasyPositions: string[] | null | undefined,
): string | null {
  for (const raw of [position, ...(fantasyPositions ?? [])]) {
    if (!raw) continue;
    const upper = raw.trim().toUpperCase();
    const resolved = POSITION_ALIASES[upper] ?? upper;
    if (FANTASY_POSITIONS.has(resolved)) return resolved;
  }
  return null;
}

export function parseSleeperPlayers(
  raw: Record<string, unknown>,
): SleeperPlayer[] {
  const players: SleeperPlayer[] = [];

  for (const value of Object.values(raw)) {
    const parsed = SleeperPlayerSchema.safeParse(value);
    if (!parsed.success) continue;
    const p = parsed.data;

    const position = fantasyPosition(p.position, p.fantasy_positions);
    if (!position) continue;

    const fullName =
      p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
    if (!fullName) continue;

    players.push({
      sleeperId: p.player_id,
      fullName,
      // Team defenses carry no `search_full_name`; normalizing the assembled
      // name with the same rules keeps the join key populated for every row.
      searchName: p.search_full_name || normalizeName(fullName),
      position,
      nflTeam: p.team ?? null,
      age: p.age ?? null,
      yearsExp: p.years_exp ?? null,
      status: p.status ?? null,
      injuryStatus: p.injury_status ?? null,
      yahooId: p.yahoo_id ? String(p.yahoo_id) : null,
      espnId: p.espn_id ? String(p.espn_id) : null,
      birthDate: p.birth_date ?? null,
      active: p.active ?? true,
    });
  }

  return players;
}

const StatBlockSchema = z.record(z.string(), z.number());

export type StatLine = {
  sleeperId: string;
  ptsPpr: number | null;
  stats: Record<string, number>;
};

/** Shared shape for `/stats/nfl/...` and `/projections/nfl/...` responses. */
export function parseStatMap(
  raw: Record<string, unknown>,
): StatLine[] {
  const lines: StatLine[] = [];

  for (const [sleeperId, value] of Object.entries(raw)) {
    const parsed = StatBlockSchema.safeParse(value);
    if (!parsed.success || !sleeperId) continue;

    const { pts_ppr, ...rest } = parsed.data;
    lines.push({
      sleeperId,
      ptsPpr: typeof pts_ppr === "number" ? pts_ppr : null,
      stats: rest,
    });
  }

  return lines;
}

/**
 * The points a stat or projection line is worth *in this league*. Sleeper
 * ships three scorings per line; picking by the league's real `ppr` modifier
 * keeps §1.2's rule — scoring is read from Yahoo, never assumed — true all the
 * way down to the value engine's inputs.
 */
export function scoredPoints(line: StatLine, ppr: number): number | null {
  if (ppr >= 0.75) return line.ptsPpr;
  const key = ppr <= 0.25 ? "pts_std" : "pts_half_ppr";
  return line.stats[key] ?? line.ptsPpr;
}

/** Games played, as Sleeper reports it on a season line. */
export function gamesPlayed(line: StatLine): number | null {
  return line.stats.gp ?? null;
}

/** The three scorings Sleeper ships on any line that describes real football. */
const SCORING_KEYS = ["pts_ppr", "pts_half_ppr", "pts_std"] as const;

/**
 * Whether a line is a game rather than a placeholder.
 *
 * A weekly payload lists every player in the league, most of them with an
 * empty object or a lone ADP field — a player on a bye, or one who never
 * dressed, comes back indistinguishable from one Sleeper simply has nothing
 * for. Rows like that are dropped before they are written, because eighteen
 * weeks of them is tens of thousands of rows that say nothing, and because a
 * *missing* week is exactly how the detail page renders "no game".
 */
export function hasScoring(line: StatLine): boolean {
  if (line.ptsPpr !== null) return true;
  return SCORING_KEYS.some((key) => typeof line.stats[key] === "number");
}

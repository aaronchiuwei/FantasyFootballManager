/** Pure parsers for Sleeper payloads. No transport, so fixture-testable. */
import { z } from "zod";

import { normalizeName } from "./name-normalize";

export const SleeperStateSchema = z.object({
  week: z.number(),
  season: z.string(),
  season_type: z.enum(["pre", "regular", "post", "off"]),
  display_week: z.number(),
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

export function parseSleeperPlayers(
  raw: Record<string, unknown>,
): SleeperPlayer[] {
  const players: SleeperPlayer[] = [];

  for (const value of Object.values(raw)) {
    const parsed = SleeperPlayerSchema.safeParse(value);
    if (!parsed.success) continue;
    const p = parsed.data;

    const position = p.position ?? p.fantasy_positions?.[0] ?? null;
    if (!position || !FANTASY_POSITIONS.has(position)) continue;

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

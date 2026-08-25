/** Pure parser for FantasyCalc payloads. No transport, so fixture-testable. */
import { z } from "zod";

const FantasyCalcPlayerSchema = z.object({
  player: z.object({
    id: z.number(),
    name: z.string(),
    position: z.string(),
    sleeperId: z.union([z.string(), z.number()]).nullish(),
    espnId: z.union([z.string(), z.number()]).nullish(),
    mflId: z.union([z.string(), z.number()]).nullish(),
    fleaflickerId: z.union([z.string(), z.number()]).nullish(),
    maybeTeam: z.string().nullish(),
    maybeBirthday: z.string().nullish(),
    maybeDraftInfo: z
      .object({ year: z.number(), round: z.number(), pick: z.number() })
      .nullish(),
  }),
  value: z.number(),
  overallRank: z.number(),
  positionRank: z.number(),
  trend30Day: z.number().nullish(),
  redraftValue: z.number().nullish(),
  maybeTier: z.number().nullish(),
  maybeAdp: z.number().nullish(),
  maybeRosterPercent: z.number().nullish(),
});

export type FantasyCalcPlayer = {
  fantasyCalcId: number;
  name: string;
  position: string;
  sleeperId: string | null;
  nflTeam: string | null;
  birthday: string | null;
  draftYear: number | null;
  /** Market value on the scale requested (redraft here, per §1.1). */
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number | null;
  tier: number | null;
  adp: number | null;
  rosterPercent: number | null;
};

export function parseFantasyCalcValues(raw: unknown[]): FantasyCalcPlayer[] {
  const players: FantasyCalcPlayer[] = [];

  for (const entry of raw) {
    const parsed = FantasyCalcPlayerSchema.safeParse(entry);
    if (!parsed.success) continue;
    const p = parsed.data;

    players.push({
      fantasyCalcId: p.player.id,
      name: p.player.name,
      position: p.player.position,
      sleeperId: p.player.sleeperId ? String(p.player.sleeperId) : null,
      nflTeam: p.player.maybeTeam ?? null,
      birthday: p.player.maybeBirthday ?? null,
      draftYear: p.player.maybeDraftInfo?.year ?? null,
      // isDynasty=false returns redraft values directly in `value`; keep the
      // explicit fallback in case a caller ever passes isDynasty=true, where
      // `value` is the dynasty scale and `redraftValue` is the one we want.
      value: p.redraftValue ?? p.value,
      overallRank: p.overallRank,
      positionRank: p.positionRank,
      trend30Day: p.trend30Day ?? null,
      tier: p.maybeTier ?? null,
      adp: p.maybeAdp ?? null,
      rosterPercent: p.maybeRosterPercent ?? null,
    });
  }

  return players;
}

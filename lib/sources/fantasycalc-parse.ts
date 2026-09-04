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
  /** ESPN's own id, when FantasyCalc has one. The ESPN crosswalk's step 1. */
  espnId: string | null;
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
      espnId: p.player.espnId ? String(p.player.espnId) : null,
      nflTeam: p.player.maybeTeam ?? null,
      birthday: p.player.maybeBirthday ?? null,
      draftYear: p.player.maybeDraftInfo?.year ?? null,
      // `value`, never `redraftValue`, and the distinction is not cosmetic.
      //
      // Every request this app makes carries `isDynasty=false` (§1.1), and on
      // that request `value` is the redraft board **for the parameters that
      // were asked for** — it moves with numQbs, numTeams and ppr alike.
      // `redraftValue` is a fixed 12-team, full-PPR baseline: it tracks
      // numQbs and ignores the other two outright. Preferring it therefore
      // threw away half the parameterization silently, pricing an 8-team
      // standard league off the 12-team PPR board while the params key on the
      // row claimed otherwise. Measured on the live API: Puka Nacua at 8 / 12
      // / 14 teams is 8,771 / 8,915 / 9,008 in `value` and 8,915 in all three
      // in `redraftValue`.
      value: p.value,
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

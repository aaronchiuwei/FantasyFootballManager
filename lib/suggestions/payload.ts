/**
 * What a cached suggestion actually stores — §8's `trade_suggestions.payload`
 * for §9's two-team search, and `cycle_suggestions.payload` for Phase 9's
 * three-team one.
 *
 * Both live here rather than in two files because they are the same claim at
 * two sizes and they share an asset: a frozen player with their value, their
 * provenance and the projection the lineup delta was computed from. A second
 * copy of that schema next door would be a second answer to "what did this
 * suggestion think a player was worth."
 *
 * The same arrangement `lib/trades/saved.ts` uses, for the same reasons: pure,
 * separate from the search that produced it, and parsed with Zod on the way out
 * of Postgres because `jsonb` is `unknown` and a payload written by an older
 * version of this file is a real thing that can be sitting in the table.
 *
 * That Zod dependency is why nothing in the browser may import a *value* from
 * here — only the type — or §10's bundle guardrail pays for a parser the client
 * never runs.
 *
 * **Provenance is in the payload, not alongside it.** §5's rule is that a value
 * says where it came from, and a suggestion is a claim built out of a dozen
 * values at once. Every asset carries its own `source`, the package carries the
 * share of itself that is market-priced, and it carries whether §6's error bars
 * already swallow the margin. A user reading a suggested trade is being asked
 * to send it to someone; they are owed the same answer the analyzer gives them
 * when they build one by hand.
 */
import { z } from "zod";

import type { LineupChange } from "@/lib/needs/lineup";
import type { VerdictBand } from "@/lib/trades/analyze";

import { worstLeg, type CycleSuggestion } from "./cycles";
import type { Suggestion, SuggestionAsset } from "./search";

/** Bumped when the shape changes; an unreadable payload is skipped, not guessed at. */
export const SUGGESTION_VERSION = 1;

const assetSchema = z.object({
  playerId: z.number(),
  name: z.string(),
  position: z.string().nullable(),
  nflTeam: z.string().nullable(),
  injuryStatus: z.string().nullable(),
  /**
   * Sleeper's portrait. Optional, and deliberately not a version bump: a
   * payload frozen before this field existed is still a correct description of
   * the trade it describes, and invalidating every cached suggestion in the
   * table to add a picture would be a re-run of §9's search for nothing. Those
   * rows render the fallback mark until the next sync rewrites them.
   */
  headshot: z.string().nullish(),
  value: z.number(),
  source: z.enum(["market", "model", "model_capped", "floor"]),
  /** Rest-of-season projected points, the currency the lineup delta is in. */
  points: z.number().nullable(),
});

const sideSchema = z.object({
  teamId: z.string(),
  teamName: z.string().nullable(),
  /** §6's side total: base + bonus + headline − depth penalty. */
  total: z.number(),
  assets: z.array(assetSchema),
  /** What this team's starting lineup does, in projected points. */
  lineup: z.object({
    before: z.number(),
    after: z.number(),
    delta: z.number(),
    empty: z.number(),
    unprojected: z.number(),
  }),
});

export const suggestionPayloadSchema = z.object({
  version: z.literal(SUGGESTION_VERSION),
  /** Only the fair bands can be here; the check constraint says so too. */
  band: z.enum(["even", "slight"]),
  pct: z.number(),
  delta: z.number(),
  /** §5: the share of the value on the table that carries a market price. */
  marketShare: z.number(),
  /** §6: true when the margin is inside what the modelled values could be wrong by. */
  withinNoise: z.boolean(),
  /** §9's objective, repeated in the payload so a card is self-contained. */
  minGain: z.number(),
  totalGain: z.number(),
  a: sideSchema,
  b: sideSchema,
});

export type SuggestionPayload = z.infer<typeof suggestionPayloadSchema>;
export type SuggestionPayloadAsset = z.infer<typeof assetSchema>;
export type SuggestionPayloadSide = z.infer<typeof sideSchema>;

/** Everything the payload needs off an asset beyond what the math reads. */
export type NamedSuggestionAsset = SuggestionAsset & {
  name: string;
  nflTeam: string | null;
  injuryStatus: string | null;
  headshotUrl: string | null;
};

export type SuggestionSideMeta = { teamId: string; teamName: string | null };

/** One player, as both payload shapes store them. */
function freezeAsset(asset: NamedSuggestionAsset): SuggestionPayloadAsset {
  return {
    playerId: asset.playerId,
    name: asset.name,
    position: asset.position,
    nflTeam: asset.nflTeam,
    injuryStatus: asset.injuryStatus,
    headshot: asset.headshotUrl,
    value: asset.value,
    source: asset.source,
    points: asset.points,
  };
}

function freezeSide(
  meta: SuggestionSideMeta,
  total: number,
  assets: NamedSuggestionAsset[],
  lineup: LineupChange,
): SuggestionPayloadSide {
  return {
    teamId: meta.teamId,
    teamName: meta.teamName,
    total,
    assets: assets.map(freezeAsset),
    lineup: {
      before: lineup.before,
      after: lineup.after,
      delta: lineup.delta,
      empty: lineup.empty,
      unprojected: lineup.unprojected,
    },
  };
}

/**
 * Freezes one search result into a payload.
 *
 * The verdict is taken off the analysis rather than recomputed, so the row and
 * the analyzer can never disagree about a trade the analyzer decided. A
 * suggestion with no verdict is not a suggestion — the search cannot produce
 * one, and this refuses rather than inventing a band for it (§4).
 */
export function buildSuggestionPayload<T extends NamedSuggestionAsset>(
  suggestion: Suggestion<T>,
  names: { a: SuggestionSideMeta; b: SuggestionSideMeta },
): SuggestionPayload | null {
  const { verdict } = suggestion.analysis;
  if (!verdict) return null;
  if (verdict.band !== "even" && verdict.band !== "slight") return null;

  return {
    version: SUGGESTION_VERSION,
    band: verdict.band,
    pct: verdict.pct,
    delta: verdict.delta,
    marketShare: suggestion.analysis.marketShare,
    withinNoise: verdict.withinNoise,
    minGain: suggestion.score.minGain,
    totalGain: suggestion.score.totalGain,
    a: freezeSide(names.a, suggestion.analysis.a.total, suggestion.a, suggestion.lineupA),
    b: freezeSide(names.b, suggestion.analysis.b.total, suggestion.b, suggestion.lineupB),
  };
}

/** Null rather than a throw: one unreadable row must not take the board down. */
export function parseSuggestionPayload(payload: unknown): SuggestionPayload | null {
  const parsed = suggestionPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Phase 9 — a three-team cycle (§7, Requirement 11)
// ---------------------------------------------------------------------------

/** Its own version, because a cycle payload can change without a pair payload doing. */
export const CYCLE_VERSION = 1;

/**
 * One participant, frozen.
 *
 * The shape is deliberately per-*team* rather than per-side, because that is
 * what a cycle is made of: everybody sends one package and receives a different
 * one, and there are no "two sides" to put the numbers on. `sent` and
 * `received` are §6's own side totals over this manager's own ledger, and `pct`
 * and `band` are the verdict on that ledger alone — which is the rule the whole
 * feature turns on. A cycle is not fair because it balances; it is fair only if
 * every one of these three rows is.
 */
const cycleLegSchema = z.object({
  teamId: z.string(),
  teamName: z.string().nullable(),
  /** Where this leg's players land. Whoever this team receives from is the leg before. */
  toTeamId: z.string(),
  assets: z.array(assetSchema),
  /** §6's side total for what this team gives up. */
  sent: z.number(),
  /** §6's side total for what reaches them. */
  received: z.number(),
  pct: z.number(),
  band: z.enum(["even", "slight"]),
  /** §6: true when this leg's margin is inside what its modelled values could be wrong by. */
  withinNoise: z.boolean(),
  marketShare: z.number(),
  lineup: z.object({
    before: z.number(),
    after: z.number(),
    delta: z.number(),
    empty: z.number(),
    unprojected: z.number(),
  }),
});

export const cyclePayloadSchema = z.object({
  version: z.literal(CYCLE_VERSION),
  /** The team the search was run for. Always `legs[0]`. */
  anchorTeamId: z.string(),
  /** The **worst** leg's band, not an average of three. */
  band: z.enum(["even", "slight"]),
  /** The worst leg's `pct` — a cycle is as sendable as its most lopsided leg. */
  maxPct: z.number(),
  /** §9's objective, folded over three: `min(Δa, Δb, Δc)`. */
  minGain: z.number(),
  totalGain: z.number(),
  /** §5, over every asset on the table once rather than three overlapping ledgers. */
  marketShare: z.number(),
  /** Whether the worst leg's margin is inside its own error bars. */
  withinNoise: z.boolean(),
  legs: z.tuple([cycleLegSchema, cycleLegSchema, cycleLegSchema]),
});

export type CyclePayload = z.infer<typeof cyclePayloadSchema>;
export type CyclePayloadLeg = z.infer<typeof cycleLegSchema>;

/**
 * Freezes one cycle into a payload.
 *
 * Every verdict is read off the leg's own `analysis` rather than recomputed, so
 * a stored cycle and the analyzer can never disagree about a ledger the
 * analyzer already decided. A leg with no verdict, or one outside the fair
 * bands, refuses the whole payload rather than being written under an invented
 * band — §4's rule, and the check constraint on the column says the same thing
 * from the other side.
 */
export function buildCyclePayload<T extends NamedSuggestionAsset>(
  cycle: CycleSuggestion<T>,
  teamName: (teamId: string) => string | null,
): CyclePayload | null {
  const legs: CyclePayloadLeg[] = [];

  for (const leg of cycle.legs) {
    const { verdict } = leg.analysis;
    if (!verdict || !isFairBand(verdict.band)) return null;

    legs.push({
      teamId: leg.teamId,
      teamName: teamName(leg.teamId),
      toTeamId: leg.toTeamId,
      assets: leg.assets.map(freezeAsset),
      sent: leg.analysis.a.total,
      received: leg.analysis.b.total,
      pct: verdict.pct,
      band: verdict.band,
      withinNoise: verdict.withinNoise,
      marketShare: leg.analysis.marketShare,
      lineup: {
        before: leg.lineup.before,
        after: leg.lineup.after,
        delta: leg.lineup.delta,
        empty: leg.lineup.empty,
        unprojected: leg.lineup.unprojected,
      },
    });
  }

  const worst = worstLeg(cycle);
  const worstVerdict = worst.analysis.verdict!;
  if (!isFairBand(worstVerdict.band)) return null;

  return {
    version: CYCLE_VERSION,
    anchorTeamId: cycle.anchorTeamId,
    band: worstVerdict.band,
    maxPct: cycle.score.pct,
    minGain: cycle.score.minGain,
    totalGain: cycle.score.totalGain,
    marketShare: cycle.score.marketShare,
    withinNoise: worstVerdict.withinNoise,
    legs: [legs[0], legs[1], legs[2]],
  };
}

export function parseCyclePayload(payload: unknown): CyclePayload | null {
  const parsed = cyclePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

/** The band is narrowed here so callers do not have to widen `VerdictBand`. */
export function isFairBand(band: VerdictBand): band is "even" | "slight" {
  return band === "even" || band === "slight";
}

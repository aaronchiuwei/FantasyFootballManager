/**
 * What a cached suggestion actually stores (§8 `trade_suggestions.payload`).
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

import type { Suggestion, SuggestionAsset } from "./search";

/** Bumped when the shape changes; an unreadable payload is skipped, not guessed at. */
export const SUGGESTION_VERSION = 1;

const assetSchema = z.object({
  playerId: z.number(),
  name: z.string(),
  position: z.string().nullable(),
  nflTeam: z.string().nullable(),
  injuryStatus: z.string().nullable(),
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
};

export type SuggestionSideMeta = { teamId: string; teamName: string | null };

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
    assets: assets.map((asset) => ({
      playerId: asset.playerId,
      name: asset.name,
      position: asset.position,
      nflTeam: asset.nflTeam,
      injuryStatus: asset.injuryStatus,
      value: asset.value,
      source: asset.source,
      points: asset.points,
    })),
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

/** The band is narrowed here so callers do not have to widen `VerdictBand`. */
export function isFairBand(band: VerdictBand): band is "even" | "slight" {
  return band === "even" || band === "slight";
}

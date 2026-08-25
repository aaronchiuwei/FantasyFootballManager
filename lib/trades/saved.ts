/**
 * What a saved trade actually stores (§8 `saved_trades.payload`).
 *
 * Pure, and deliberately not part of `analyze.ts`: the math is a function of
 * today's values, and this is a record of what those values *were*. It has no
 * transport of its own either — the store next door does the reading and
 * writing, and this file only knows the shape.
 *
 * Parsed with Zod on the way out of Postgres for the ordinary reason: `jsonb`
 * is `unknown`, and a payload written by an older version of this file is a
 * real thing that can be in the table. That Zod dependency is also why nothing
 * in the browser may import a *value* from here — only the type — or §10's
 * bundle guardrail pays for a parser the client never runs.
 */
import { z } from "zod";

import type { TradeAnalysis, TradeAsset, TradeParams } from "./analyze";

/** Bumped when the shape changes; an unreadable payload is skipped, not guessed at. */
export const SNAPSHOT_VERSION = 1;

const assetSchema = z.object({
  playerId: z.number(),
  name: z.string(),
  position: z.string().nullable(),
  value: z.number(),
  source: z.enum(["market", "model", "model_capped", "floor"]),
});

const sideSchema = z.object({
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  total: z.number(),
  assets: z.array(assetSchema),
});

export const tradeSnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  savedAt: z.string(),
  params: z.object({
    alpha: z.number(),
    beta: z.number(),
    gamma: z.number(),
  }),
  band: z.enum(["even", "slight", "clear", "lopsided"]),
  winner: z.enum(["a", "b"]).nullable(),
  delta: z.number(),
  pct: z.number(),
  marketShare: z.number(),
  a: sideSchema,
  b: sideSchema,
});

export type TradeSnapshot = z.infer<typeof tradeSnapshotSchema>;
export type SnapshotAsset = z.infer<typeof assetSchema>;

/** The asset shape the snapshot needs beyond what the math reads. */
export type NamedAsset = TradeAsset & { name: string };

export type SnapshotSide = {
  teamId: string | null;
  teamName: string | null;
};

/**
 * Freezes an analysis into a payload.
 *
 * Names and values are copied rather than referenced by id on purpose: values
 * move on every sync, and a saved trade whose verdict silently re-derives is
 * not a record of anything. Reloading a saved trade into the analyzer re-prices
 * it against today's board — which is the interesting comparison, and needs the
 * old numbers to still be there to compare against.
 */
export function buildSnapshot<T extends NamedAsset>(
  analysis: TradeAnalysis<T>,
  sides: { a: SnapshotSide; b: SnapshotSide },
  params: TradeParams,
  savedAt: string = new Date().toISOString(),
): TradeSnapshot | null {
  // Only an analysed trade can be saved. A blocked one has no verdict to
  // record, and inventing a band for it would defeat §4's whole point.
  if (!analysis.verdict) return null;

  const side = (key: "a" | "b") => ({
    teamId: sides[key].teamId,
    teamName: sides[key].teamName,
    total: analysis[key].total,
    assets: analysis[key].assets.map((asset) => ({
      playerId: asset.playerId,
      name: asset.name,
      position: asset.position,
      value: asset.value,
      source: asset.source,
    })),
  });

  return {
    version: SNAPSHOT_VERSION,
    savedAt,
    params: { alpha: params.alpha, beta: params.beta, gamma: params.gamma },
    band: analysis.verdict.band,
    winner: analysis.verdict.winner,
    delta: analysis.verdict.delta,
    pct: analysis.verdict.pct,
    marketShare: analysis.marketShare,
    a: side("a"),
    b: side("b"),
  };
}

/** Null rather than a throw: one unreadable row must not take the list down. */
export function parseSnapshot(payload: unknown): TradeSnapshot | null {
  const parsed = tradeSnapshotSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

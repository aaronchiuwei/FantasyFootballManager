/**
 * The trade math of §6, as a pure function of cached values.
 *
 * No `server-only` and no transport, for the same reason `lib/sync/plan.ts`
 * has none: §2 requires this to be "pure and fast enough to run on every
 * keystroke against cached values", so the browser runs exactly the function
 * the server would, over values a sync already computed. Nothing in here
 * fetches, and nothing in here is allowed to be slow.
 *
 * Generic over the asset so the caller's richer row — name, headshot, whatever
 * the UI needs — survives the trip through the math and comes back out in the
 * side totals and the block reasons.
 */
import type { ValueSource } from "@/lib/values/engine";
import { isTradeAsset } from "@/lib/values/engine";

/** The only facts the math reads off a player. */
export type TradeAsset = {
  playerId: number;
  position: string | null;
  value: number;
  source: ValueSource;
};

export type TradeSideKey = "a" | "b";

export type TradeParams = {
  /** Best-player bonus, per side. */
  alpha: number;
  /** Depth penalty per extra body. */
  beta: number;
  /** Extra for holding the single best player in the whole deal. */
  gamma: number;
};

/**
 * §6's defaults, with one deliberate departure from §8's schema sketch.
 *
 * §8 wrote `alpha 0.15`. §6 then compared the two candidate value curves and
 * found FantasyCalc steeply top-heavy — its top 100 hold 92.3% of all league
 * value against KeepTradeCut's 53% — which means **the superstar premium is
 * already priced into the numbers being summed**. A 0.15 alpha on top of that
 * charges the premium twice and the analyzer over-approves every 2-for-1. §6
 * is explicit about the consequence ("start at α ≈ 0.08, not the 0.15 a
 * flat-curve source would want") and calls it the single most important tuning
 * decision in the app, so 0.08 is what ships. The golden-file tests in
 * `analyze.test.ts` are the calibration mechanism §13 asks for.
 */
export const DEFAULT_TRADE_PARAMS: TradeParams = {
  alpha: 0.08,
  beta: 0.03,
  gamma: 0.05,
};

/** Ranges the sliders — and the database check constraints — agree on. */
export const PARAM_LIMITS: Record<keyof TradeParams, { min: number; max: number; step: number }> = {
  alpha: { min: 0, max: 0.3, step: 0.01 },
  beta: { min: 0, max: 0.15, step: 0.005 },
  gamma: { min: 0, max: 0.2, step: 0.01 },
};

export type VerdictBand = "even" | "slight" | "clear" | "lopsided";

/** §6's fairness bands, as upper bounds on `pct`. */
export const BAND_THRESHOLDS: Record<Exclude<VerdictBand, "lopsided">, number> = {
  even: 0.03,
  slight: 0.08,
  clear: 0.15,
};

/**
 * Three verdict tokens (`--verdict-fair`, `--verdict-tilted`,
 * `--verdict-lopsided`) against four bands, so one boundary has to carry the
 * color change. It is the 8% one, because that is where the rest of the app
 * already draws the line: §9's win-win search filters to `pct < 8%` and calls
 * what survives "fair by value". A slight edge is a fair trade that happens to
 * have a direction.
 */
export const BAND_META: Record<
  VerdictBand,
  { label: string; tone: "fair" | "tilted" | "lopsided"; summary: string }
> = {
  even: {
    label: "Even",
    tone: "fair",
    summary: "Inside the noise of the market itself. This is a coin flip.",
  },
  slight: {
    label: "Slight edge",
    tone: "fair",
    summary: "A real but small edge. Still fair by the standard the rest of the app uses.",
  },
  clear: {
    label: "Clear winner",
    tone: "tilted",
    summary: "One side is meaningfully ahead. Expect the other manager to notice.",
  },
  lopsided: {
    label: "Lopsided",
    tone: "lopsided",
    summary: "Far outside any fair band. This is not a trade, it is a gift.",
  },
};

export function bandFor(pct: number): VerdictBand {
  if (pct < BAND_THRESHOLDS.even) return "even";
  if (pct < BAND_THRESHOLDS.slight) return "slight";
  if (pct < BAND_THRESHOLDS.clear) return "clear";
  return "lopsided";
}

/**
 * The `pct` at which the balance beam is fully tipped. Twice the lopsided
 * threshold, so a trade that only just crosses into lopsided still has visible
 * room to get worse — a beam that pins at the band boundary would make a 16%
 * robbery and a 90% one look identical.
 */
export const FULL_TILT_PCT = 0.3;

/**
 * How wrong a value of each provenance can plausibly be, as a share of itself.
 *
 * Market is 0 — not because FantasyCalc is perfect, but because on this app's
 * own terms the market *is* the scale (§5: market values are never adjusted,
 * and the number's whole worth is that it is quotable). An all-market trade's
 * margin is therefore a real margin, and the band stands on its own.
 *
 * The modelled tiers are where the honesty is owed. §5 already says a trade
 * built on model values is a fuzzier trade; this is that sentence turned into
 * arithmetic, so the fuzziness reaches the verdict instead of stopping at the
 * badge.
 */
const VALUE_UNCERTAINTY: Record<ValueSource, number> = {
  market: 0,
  model: 0.35,
  model_capped: 0.5,
  floor: 1,
};

export type SideTotals<T extends TradeAsset = TradeAsset> = {
  assets: T[];
  count: number;
  /** Σ value, before any of §6's adjustments. */
  base: number;
  median: number;
  best: T | null;
  /** `alpha × value(best)`. */
  bonus: number;
  /** `gamma × value(best)`, only on the side holding the deal's best player. */
  headlineBonus: number;
  /** `beta × (bodies this side sends beyond the other's count) × median`. */
  depthPenalty: number;
  total: number;
  /** Share of `base` that carries a market price. */
  marketShare: number;
  /** Plausible error in this side's total, in value units. */
  noise: number;
  /** §4: no market price and no projection — these refuse a verdict. */
  unvalued: T[];
  /** §3: kickers and defenses are streamed, not traded. */
  nonTradeAssets: T[];
};

export type TradeBlock<T extends TradeAsset = TradeAsset> =
  | { kind: "empty"; side: TradeSideKey | "both" }
  | { kind: "unvalued"; side: TradeSideKey; assets: T[] };

export type TradeVerdict = {
  band: VerdictBand;
  /** Null on an even trade: nobody wins a coin flip. */
  winner: TradeSideKey | null;
  /** `A_total − B_total`, in value units. */
  delta: number;
  /** `|Δ| / max(A_total, B_total)`. */
  pct: number;
  /** −1 (B is ahead) … +1 (A is ahead), saturating at `FULL_TILT_PCT`. */
  tilt: number;
  /** The margin the modelled values in this deal could account for on their own. */
  noisePct: number;
  /** True when the margin is inside that error — the edge may not be real. */
  withinNoise: boolean;
};

export type TradeAnalysis<T extends TradeAsset = TradeAsset> = {
  a: SideTotals<T>;
  b: SideTotals<T>;
  /**
   * **Null when the trade is blocked**, which is §4's "the trade analyzer
   * refuses to declare a verdict" made unrepresentable rather than merely
   * documented: there is no verdict object to render.
   */
  verdict: TradeVerdict | null;
  blocks: TradeBlock<T>[];
  /** Share of all value on the table that carries a market price. */
  marketShare: number;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Everything about one package that does not depend on the other one.
 *
 * `gamma` and `beta` both do — one needs to know which side holds the best
 * player in the deal, the other how many bodies the other side is sending —
 * so both are applied afterwards by `analyzeTrade`.
 */
function summarizeSide<T extends TradeAsset>(
  assets: T[],
  params: TradeParams,
): SideTotals<T> {
  const base = assets.reduce((sum, asset) => sum + asset.value, 0);

  let best: T | null = null;
  for (const asset of assets) {
    if (best === null || asset.value > best.value) best = asset;
  }

  const middle = median(assets.map((asset) => asset.value));

  // §6: proportional, never flat. A flat bonus makes every package want
  // exactly one superstar regardless of scale, which is trivially exploitable.
  const bonus = best === null ? 0 : params.alpha * best.value;

  const marketValue = assets
    .filter((asset) => asset.source === "market")
    .reduce((sum, asset) => sum + asset.value, 0);

  return {
    assets,
    count: assets.length,
    base,
    median: middle,
    best,
    bonus,
    headlineBonus: 0,
    // Depends on the other package's size, so `analyzeTrade` charges it after
    // both sides are summarized.
    depthPenalty: 0,
    total: base + bonus,
    marketShare: base === 0 ? 1 : marketValue / base,
    // Linear rather than in quadrature: the errors on two modelled values are
    // not independent (they come off one isotonic fit), and a verdict that
    // overstates its own certainty is the failure mode worth avoiding.
    noise: assets.reduce(
      (sum, asset) => sum + asset.value * VALUE_UNCERTAINTY[asset.source],
      0,
    ),
    unvalued: assets.filter((asset) => asset.source === "floor"),
    // A null position is unknown, not a kicker — it must not be labelled one.
    nonTradeAssets: assets.filter(
      (asset) => asset.position !== null && !isTradeAsset(asset.position),
    ),
  };
}

/**
 * §6's optional gamma — "the single best player in the *entire* trade" — as a
 * premium on the **margin** between the two sides' headliners rather than on
 * the headliner's whole value.
 *
 * A deliberate departure from the literal formula, made to preserve the
 * property §6 itself argues for one paragraph earlier: applied per side, the
 * bonus should "largely cancel" when both packages are headlined by comparable
 * studs. Charged on the full value, gamma does the opposite — it is worth zero
 * when the two best players are exactly equal and 5% of a first-rounder the
 * moment one is a single point better. That discontinuity means two
 * indistinguishable trades get different verdicts, which is a bug wearing a
 * formula's clothes.
 *
 * On the margin it is continuous, it still pays the side holding the genuine
 * top asset in a lopsided-headliner deal (which is the consolidation premium
 * Requirement 6 asks for), and it collapses to nothing between equals.
 */
function awardHeadline<T extends TradeAsset>(
  side: SideTotals<T>,
  margin: number,
  gamma: number,
): void {
  side.headlineBonus = gamma * margin;
  side.total += side.headlineBonus;
}

/**
 * §6's beta, charged on the **difference** in package size rather than on each
 * side's own size.
 *
 * The literal reading — "beta per extra body, per side" — charges both halves
 * of a three-for-three, which is wrong twice over. Nobody's roster gets tighter
 * in an even swap: three players leave and three arrive, and the number of
 * spots in use afterwards is exactly what it was before. Worse, the charge is
 * scaled by each side's own median, so two packages of equal size are billed
 * *different* amounts, and a genuinely even 3-for-3 picks up a tilt toward
 * whichever side happens to hold the cheaper middle player. That is a verdict
 * invented by the formula rather than found in the trade.
 *
 * On the difference it does the job it was introduced for and nothing else.
 * Consolidation is what costs roster spots: sending three for one means the
 * other manager has to find two spots and drop two players, so the three-side's
 * package is discounted for the two bodies it sends *in excess*. Between equal
 * counts it collapses to zero — the same property `awardHeadline` above exists
 * to preserve, for the same reason.
 *
 * The median is the paying side's own, because the marginal bodies are theirs:
 * what the deal costs in roster spots is roughly the middle player of the pile
 * being sent, times how many of them are surplus to the swap.
 */
function chargeDepth<T extends TradeAsset>(
  side: SideTotals<T>,
  extraBodies: number,
  beta: number,
): void {
  side.depthPenalty = beta * extraBodies * side.median;
  side.total -= side.depthPenalty;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Values both packages, applies §6's bonus math, and returns the fairness
 * verdict — or refuses one.
 *
 * Two things stop a verdict from being issued, and they are different failures:
 *
 * - **An unvalued player.** §4's non-negotiable rule. A `floor` value means the
 *   market has no price and there is no projection to model from; summing it as
 *   though it were a real number is the worst failure mode this app has, because
 *   it is invisible.
 * - **An empty side.** A half-built trade is incomplete, not lopsided. Declaring
 *   "LOPSIDED" at a user who has added one player and is reaching for the second
 *   is a calculator shouting at its own loading state.
 */
export function analyzeTrade<T extends TradeAsset>(
  sideA: T[],
  sideB: T[],
  params: TradeParams = DEFAULT_TRADE_PARAMS,
): TradeAnalysis<T> {
  const a = summarizeSide(sideA, params);
  const b = summarizeSide(sideB, params);

  // Equal headliners mean there is no single best player in the deal, and the
  // premium correctly falls to zero rather than being awarded twice.
  const bestA = a.best?.value ?? 0;
  const bestB = b.best?.value ?? 0;

  if (bestA > bestB) awardHeadline(a, bestA - bestB, params.gamma);
  else if (bestB > bestA) awardHeadline(b, bestB - bestA, params.gamma);

  // Only the side sending more players pays for roster spots, and only for the
  // bodies beyond the even swap. A 3-for-3 costs nobody anything.
  if (a.count > b.count) chargeDepth(a, a.count - b.count, params.beta);
  else if (b.count > a.count) chargeDepth(b, b.count - a.count, params.beta);

  const blocks: TradeBlock<T>[] = [];

  if (a.count === 0 || b.count === 0) {
    blocks.push({
      kind: "empty",
      side: a.count === 0 && b.count === 0 ? "both" : a.count === 0 ? "a" : "b",
    });
  }

  if (a.unvalued.length > 0) {
    blocks.push({ kind: "unvalued", side: "a", assets: a.unvalued });
  }
  if (b.unvalued.length > 0) {
    blocks.push({ kind: "unvalued", side: "b", assets: b.unvalued });
  }

  const onTheTable = a.base + b.base;
  const marketShare =
    onTheTable === 0
      ? 1
      : (a.marketShare * a.base + b.marketShare * b.base) / onTheTable;

  if (blocks.length > 0) {
    return { a, b, verdict: null, blocks, marketShare };
  }

  const delta = a.total - b.total;
  const heaviest = Math.max(a.total, b.total);
  // Both totals are positive here — an empty side is already blocked, and
  // `player_values` carries `check (value > 0)` — but the math must not depend
  // on a database constraint to avoid dividing by zero.
  const pct = heaviest > 0 ? clamp(Math.abs(delta) / heaviest, 0, 1) : 0;
  const band = bandFor(pct);
  const noisePct = heaviest > 0 ? (a.noise + b.noise) / heaviest : 0;

  return {
    a,
    b,
    blocks,
    marketShare,
    verdict: {
      band,
      winner: band === "even" ? null : delta > 0 ? "a" : "b",
      delta,
      pct,
      tilt: clamp(delta === 0 ? 0 : Math.sign(delta) * (pct / FULL_TILT_PCT), -1, 1),
      noisePct,
      // An even verdict is not an edge, so there is nothing for the error bars
      // to swallow — flagging it would read as doubt about the wrong claim.
      withinNoise: band !== "even" && pct <= noisePct,
    },
  };
}

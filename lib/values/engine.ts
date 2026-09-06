/**
 * The value engine of §5, as a pure function of its inputs.
 *
 * Requirement 3 asks for a number on every player. FantasyCalc supplies 192 of
 * them from real completed redraft trades; everything below that line is
 * modelled from projections and calibrated onto the market's own scale. The
 * split is never hidden — `value_source` rides along with every row, because a
 * trade built on model values is a fuzzier trade and the user deserves to know
 * which is which.
 */
import { normalizePosition } from "@/lib/crosswalk/resolve";

import {
  fitIsotonic,
  isExtrapolated,
  predictIsotonic,
  spearman,
  type IsotonicFit,
} from "./isotonic";
import {
  baselineAt,
  replacementRanks,
  restOfSeasonPoints,
  SCORING_POSITIONS,
  type ScoringPosition,
  type StartingSlot,
} from "./vor";

export type ValueSource = "market" | "model" | "model_capped" | "floor";

/** §3: streamed off waivers every week, so their trade value genuinely is ~0. */
const NON_TRADE_POSITIONS = new Set(["K", "DEF"]);

/** Kickers and defenses are a lineup problem, not a trade asset. */
export function isTradeAsset(position: string | null): boolean {
  const normalized = normalizePosition(position);
  return normalized !== null && !NON_TRADE_POSITIONS.has(normalized);
}

/**
 * Nobody is ever worth literally nothing. §4's rule is that an unresolved or
 * unprojected player must be *visible* as such, and a hard zero both hides the
 * problem and silently rewrites trade math.
 */
export const FLOOR_VALUE = 1;

/** Fallback K/DEF ceiling for the case where no market anchor exists at all. */
export const DEFAULT_KDEF_CAP = 200;

/**
 * Where the seam sits in a position's own market prices.
 *
 * The tenth percentile rather than the minimum, and the difference is not
 * cosmetic. Measured on a live board, the cheapest market-priced running back
 * was a fading veteran at 14 — and because the guardrail was a hard `min`, that
 * one price pinned all 75 modelled running backs to 14 apiece. A handcuff
 * projected for 70 rest-of-season points and a fifth-stringer projected for 44
 * came out as the same number.
 *
 * A percentile cannot be pinned by one outlier. It still says what the seam
 * exists to say — a modelled player is below all but a handful of the players
 * the market was willing to price — while leaving the tier somewhere to spread
 * out inside.
 */
export const SEAM_PERCENTILE = 0.1;

/**
 * Where a soft cap stops being the identity and starts bending.
 *
 * Below the knee a value passes through untouched, because a modelled player
 * genuinely worth a third of the seam should be priced at a third of the seam.
 * Above it the curve compresses toward the ceiling and never reaches it, so
 * the ordering survives a clamp instead of being erased by it.
 */
export const SOFT_CAP_KNEE = 0.5;

/**
 * A ceiling that compresses rather than truncates.
 *
 * `Math.min(x, cap)` is not a cap, it is a delete: every value above the
 * ceiling comes out as the same number, and a position whose whole range sits
 * above it collapses to a single point. That is what happened to kickers (46
 * players, one distinct value) and to the model tier at every position.
 *
 * This is the identity below `SOFT_CAP_KNEE × cap`, and `t / (1 + t)` in units
 * of the remaining headroom above it. The two halves meet with the same slope,
 * so there is no kink at the knee, and the map is strictly increasing
 * everywhere — which is the property the whole fix turns on. A guardrail may
 * compress what it does not believe. It may not throw away the ordering
 * underneath.
 *
 * The rational curve is chosen over the more obvious `1 - exp(-t)` for a
 * numerical reason rather than a mathematical one: both are strictly
 * increasing on paper, but `exp(-t)` underflows to zero at t ≈ 37, so in
 * double precision the exponential really does return `cap` for every input
 * past that point and reintroduces the exact tie this function exists to
 * prevent. `t / (1 + t)` decays as `1/t` and holds its ordering out past 1e15,
 * which is comfortably beyond any value the fit can produce.
 */
export function softCap(value: number, cap: number): number {
  if (!Number.isFinite(cap) || cap <= 0) return value;

  const knee = cap * SOFT_CAP_KNEE;
  if (value <= knee) return value;

  const headroom = cap - knee;
  const t = (value - knee) / headroom;
  return knee + headroom * (t / (1 + t));
}

/** Nearest-rank percentile over an ascending list. */
function percentile(ascending: number[], share: number): number | undefined {
  if (ascending.length === 0) return undefined;
  const index = Math.ceil(share * ascending.length) - 1;
  return ascending[Math.min(ascending.length - 1, Math.max(0, index))];
}

/**
 * Confidence, surfaced as the badge's second line. Market is the market. A
 * modelled value is a real estimate; a modelled value extrapolated past the
 * bottom of the fit is an estimate about players the market declined to price,
 * and a floor value is an admission that we have nothing.
 */
const CONFIDENCE: Record<ValueSource, number> = {
  market: 1,
  model: 0.6,
  model_capped: 0.35,
  floor: 0.1,
};
const EXTRAPOLATED_CONFIDENCE = 0.45;

/**
 * Narrows the `value_source` column, which Postgres hands back as plain text.
 * A source this build does not recognize is not a source, and the callers
 * treat it as unvalued rather than guessing at its trustworthiness.
 */
export function isValueSource(value: string): value is ValueSource {
  return value in CONFIDENCE;
}

/**
 * §6: "a season-ending injury zeroes redraft value while barely denting
 * dynasty value." These multipliers apply to the **model tier only**. Market
 * values are left exactly as FantasyCalc reports them, because those come from
 * trades made by managers who already knew about the injury — discounting them
 * again charges the same news twice, and it breaks the one property that makes
 * a verdict arguable with a leaguemate: that the number is quotable.
 */
const INJURY_MULTIPLIERS: Record<string, number> = {
  IR: 0.15,
  PUP: 0.15,
  NA: 0.15,
  DNR: 0.15,
  COV: 0.9,
  SUS: 0.6,
  OUT: 0.75,
  DOUBTFUL: 0.8,
  QUESTIONABLE: 0.95,
};

/** Statuses severe enough that the market price reflects news VOR cannot see. */
const FIT_EXCLUDED_INJURIES = new Set(["IR", "PUP", "NA", "DNR", "SUS", "OUT"]);

function injuryKey(status: string | null): string | null {
  if (!status) return null;
  return status.trim().toUpperCase().replace(/[\s.]/g, "");
}

export function injuryMultiplier(status: string | null): number {
  const key = injuryKey(status);
  return key ? (INJURY_MULTIPLIERS[key] ?? 1) : 1;
}

export type MarketEntry = {
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number | null;
  tier: number | null;
};

export type EnginePlayer = {
  playerId: number;
  position: string | null;
  injuryStatus: string | null;
  /** On any roster in this league — such a player always gets a value row. */
  isRostered: boolean;
  /** Sleeper season projection, full-season PPR points. */
  projectedPoints: number | null;
  /** Season-to-date actuals, for the preseason-degradation blend (§5). */
  actualPoints: number | null;
  gamesPlayed: number | null;
  market: MarketEntry | null;
};

export type EngineConfig = {
  numTeams: number;
  rosterSlots: StartingSlot[];
  /** Weeks left in the fantasy regular season, ≥ 1. */
  weeksRemaining: number;
};

export type ValueRow = {
  playerId: number;
  position: string | null;
  value: number;
  /** Pre-guardrail value, so a clamp is visible rather than silent. */
  baseValue: number;
  source: ValueSource;
  confidence: number;
  overallRank: number;
  positionRank: number;
  trend30d: number | null;
  tier: number | null;
  vor: number | null;
  restOfSeasonPoints: number | null;
};

export type ValueReport = {
  rows: ValueRow[];
  bySource: Record<ValueSource, number>;
  /** Rows in the isotonic fit's training set. */
  overlap: number;
  /** §13: should be ≥ 0.98, else the VOR inputs are wrong. */
  rankCorrelation: number | null;
  /** §13 seam check — must stay at 0. */
  seamViolations: number;
  baselines: Partial<Record<ScoringPosition, number>>;
  replacementRanks: Partial<Record<ScoringPosition, number>>;
  kdefCap: number;
};

/**
 * Where the modelled tier at a position tops out: the `SEAM_PERCENTILE`
 * quantile of that position's market prices.
 *
 * This is the first of §5's three guardrails, and the one §13 checks for. Its
 * job is that a waiver flyer never leapfrogs the rostered starters the market
 * has priced — but "never leapfrogs *anybody*" and "never leapfrogs all but
 * the cheapest tenth" are different claims, and only the second one survives a
 * board where one priced veteran has fallen to 14 while the next is at 21.
 * Reading the seam off a percentile is what stops a single stale price from
 * deciding what every unpriced player at that position is worth.
 */
function seamCaps(players: EnginePlayer[]): Map<string, number> {
  const byPosition = new Map<string, number[]>();

  for (const player of players) {
    if (!player.market) continue;
    const position = normalizePosition(player.position);
    if (!position) continue;

    const prices = byPosition.get(position);
    if (prices) prices.push(player.market.value);
    else byPosition.set(position, [player.market.value]);
  }

  const caps = new Map<string, number>();

  for (const [position, prices] of byPosition) {
    prices.sort((a, b) => a - b);
    const seam = percentile(prices, SEAM_PERCENTILE);
    if (seam !== undefined) caps.set(position, seam);
  }

  return caps;
}

/**
 * §5's second guardrail, and the tier it actually names.
 *
 * Kickers and defenses have no market anchor and VOR flatters them badly —
 * they score consistently, so their spread above replacement reads as
 * reliability rather than scarcity. Measured against the live board, the raw
 * fit puts the best kicker at ~2,286, which would rank him inside the top 20
 * assets in the league. Something has to hold them down.
 *
 * §5 asks for the QB2/TE2 tier and that is now what this returns: the market
 * price of the `2 × numTeams`-th quarterback and of the tight end at the same
 * rank, averaged. On a 12-team board those are the 24th QB and the 24th TE,
 * which is exactly the player a manager rosters as a second one — measured at
 * 215 and 111 on one live league, 202 and 80 on another.
 *
 * It previously returned the *global* market floor instead, the cheapest
 * player FantasyCalc would price at all, which came to 5. Paired with a hard
 * `min` that did not compress a position so much as erase it: all 46 kickers
 * and all 32 defenses came out at 5 apiece, so the best kicker in football and
 * a bye-week streamer were the same number. The argument for that ceiling was
 * §3's "in redraft their trade value genuinely is near zero", which is a fair
 * claim about the *tier* and no claim at all about the ordering inside it.
 * Both are kept now: a kicker still cannot approach a startable skill player,
 * and the good ones are still worth more than the bad ones.
 *
 * The two anchors are averaged rather than minimised because the deep end of
 * the tight end market is thin and jumps around — 111 against 80 across two
 * boards of the same market — while the pair together is stable.
 */
export const KDEF_TIER_MULTIPLE = 2;

export function kdefCap(players: EnginePlayer[], numTeams: number): number {
  const rank = Math.max(1, Math.round(KDEF_TIER_MULTIPLE * Math.max(1, numTeams)));
  const anchors: number[] = [];

  for (const position of ["QB", "TE"]) {
    const priced = players
      .filter(
        (player) =>
          player.market !== null && normalizePosition(player.position) === position,
      )
      .map((player) => player.market!.value)
      .sort((a, b) => b - a);

    if (priced.length === 0) continue;
    anchors.push(priced[Math.min(priced.length - 1, rank - 1)]);
  }

  if (anchors.length === 0) return DEFAULT_KDEF_CAP;

  const mean = anchors.reduce((sum, value) => sum + value, 0) / anchors.length;
  return Math.max(FLOOR_VALUE, Math.round(mean));
}

/**
 * The largest VOR anyone carries at each position.
 *
 * Only K and DEF read this, and only because their scale has no market anchor
 * to borrow. For a skill position the isotonic fit answers "what is this VOR
 * worth in FantasyCalc points" from data; for a kicker there is no such data
 * and never will be, so the honest reading is a relative one — how far above a
 * streamer he is, as a share of how far above a streamer the best kicker in
 * football is.
 */
function topVorByPosition(prepared: Prepared[]): Map<string, number> {
  const top = new Map<string, number>();

  for (const player of prepared) {
    const position = player.normalizedPosition;
    if (position === null || player.vor === null) continue;

    const current = top.get(position);
    if (current === undefined || player.vor > current) top.set(position, player.vor);
  }

  return top;
}

type Prepared = EnginePlayer & {
  normalizedPosition: string | null;
  ros: number | null;
  vor: number | null;
};

function prepare(
  players: EnginePlayer[],
  config: EngineConfig,
): { prepared: Prepared[]; baselines: Partial<Record<ScoringPosition, number>> } {
  const weeksRemaining = Math.max(1, config.weeksRemaining);

  const withPoints: Prepared[] = players.map((player) => ({
    ...player,
    normalizedPosition: normalizePosition(player.position),
    ros: restOfSeasonPoints({
      projectedPoints: player.projectedPoints,
      actualPoints: player.actualPoints,
      gamesPlayed: player.gamesPlayed,
      weeksRemaining,
    }),
    vor: null,
  }));

  const baselines: Partial<Record<ScoringPosition, number>> = {};
  const ranks = replacementRanks(config.rosterSlots, config.numTeams);

  for (const position of SCORING_POSITIONS) {
    const points = withPoints
      .filter((player) => player.normalizedPosition === position && player.ros !== null)
      .map((player) => player.ros as number)
      .sort((a, b) => b - a);

    baselines[position] = baselineAt(points, ranks[position]);
  }

  // K and DEF have no replacement rank of their own in §5's formula — every
  // team starts exactly one and streams it. Replacement is the median, so a
  // kicker's VOR measures the edge over a waiver kicker, which is the honest
  // quantity even before the cap.
  for (const position of ["K", "DEF"]) {
    const points = withPoints
      .filter((player) => player.normalizedPosition === position && player.ros !== null)
      .map((player) => player.ros as number)
      .sort((a, b) => b - a);

    if (points.length > 0) {
      baselines[position as ScoringPosition] = baselineAt(
        points,
        Math.max(1, points.length / 2),
      );
    }
  }

  for (const player of withPoints) {
    const baseline =
      player.normalizedPosition === null
        ? undefined
        : baselines[player.normalizedPosition as ScoringPosition];

    if (player.ros !== null && baseline !== undefined) {
      player.vor = player.ros - baseline;
    }
  }

  return { prepared: withPoints, baselines };
}

/**
 * Fits VOR → market value on the players that have both. Severely injured
 * players are held out: their market price has absorbed news the projection
 * axis has not, so leaving them in teaches the fit that a high VOR is worth
 * less than it is.
 */
function buildFit(prepared: Prepared[]): {
  fit: IsotonicFit;
  overlap: number;
  rankCorrelation: number | null;
} {
  const eligible = prepared.filter(
    (player) => player.market !== null && player.vor !== null,
  );

  const key = (player: Prepared) => injuryKey(player.injuryStatus);
  const healthy = eligible.filter((player) => {
    const status = key(player);
    return status === null || !FIT_EXCLUDED_INJURIES.has(status);
  });

  // Only hold the injured out when doing so still leaves a real sample.
  const sample = healthy.length >= 30 ? healthy : eligible;

  const fit = fitIsotonic(
    sample.map((player) => ({ x: player.vor as number, y: player.market!.value })),
  );

  return {
    fit,
    overlap: sample.length,
    rankCorrelation: spearman(
      sample.map((player) => player.vor as number),
      sample.map((player) => player.market!.value),
    ),
  };
}

function compare(a: ValueRow, b: ValueRow): number {
  if (b.value !== a.value) return b.value - a.value;

  // Market outranks model at an equal value, so the seam never inverts on a tie.
  if (a.source !== b.source) {
    return (a.source === "market" ? 0 : 1) - (b.source === "market" ? 0 : 1);
  }

  // Ties are rarer than they were, now that the guardrails compress instead of
  // truncating, but they are still routine at the bottom of the board: the
  // model tier is rounded to whole points and the last few hundred players are
  // all worth about the same nothing. The values are telling the truth about
  // that; the *ordering* still has to mean something, and VOR is what it means.
  const vorA = a.vor ?? -Infinity;
  const vorB = b.vor ?? -Infinity;
  if (vorA !== vorB) return vorB - vorA;

  return a.playerId - b.playerId;
}

/**
 * Values every player supplied, on one scale, with provenance.
 *
 * The caller decides who is in scope — market-priced players, anyone rostered
 * in the league, and the projected free-agent pool. Everyone handed in comes
 * back with a row: the exit criterion for this phase is that nothing rendered
 * anywhere is missing a value.
 */
export function computeValues(
  players: EnginePlayer[],
  config: EngineConfig,
): ValueReport {
  const { prepared, baselines } = prepare(players, config);
  const { fit, overlap, rankCorrelation } = buildFit(prepared);
  const caps = seamCaps(players);
  const cap = kdefCap(players, config.numTeams);
  const topVor = topVorByPosition(prepared);

  const rows: ValueRow[] = prepared.map((player) => {
    const position = player.normalizedPosition;

    const base = {
      playerId: player.playerId,
      position,
      vor: player.vor,
      restOfSeasonPoints: player.ros,
    };

    if (player.market) {
      return {
        ...base,
        value: Math.max(FLOOR_VALUE, Math.round(player.market.value)),
        baseValue: Math.round(player.market.value),
        source: "market" as const,
        confidence: CONFIDENCE.market,
        overallRank: 0,
        positionRank: 0,
        trend30d: player.market.trend30Day,
        tier: player.market.tier,
      };
    }

    if (player.vor === null) {
      return {
        ...base,
        value: FLOOR_VALUE,
        baseValue: FLOOR_VALUE,
        source: "floor" as const,
        confidence: CONFIDENCE.floor,
        overallRank: 0,
        positionRank: 0,
        trend30d: null,
        tier: null,
      };
    }

    const fitted = Math.max(0, predictIsotonic(fit, player.vor));
    const baseValue = Math.round(fitted);

    if (position !== null && NON_TRADE_POSITIONS.has(position)) {
      // Not `min(fit, cap)`. The fit's answer for a kicker is 2,286 against a
      // ceiling of ~163, so a clamp would put every one of them on the ceiling
      // and the position would carry one number. What survives instead is the
      // shape the fit was reading: points above a streamed replacement, as a
      // share of the best kicker in football, spent across the tier.
      //
      // The baseline for these two positions is the *median* of the position
      // (see `prepare`), so half the pool sits at or below zero here and comes
      // out at the floor. That is the right answer and the same one as before:
      // a below-average kicker is not a trade asset. What has changed is that
      // an above-average one is now allowed to say so.
      const top = topVor.get(position) ?? 0;
      const share =
        top > 0 ? Math.max(0, Math.min(1, (player.vor as number) / top)) : 0;

      return {
        ...base,
        value: Math.max(
          FLOOR_VALUE,
          Math.round(FLOOR_VALUE + (cap - FLOOR_VALUE) * share),
        ),
        baseValue,
        source: "model_capped" as const,
        confidence: CONFIDENCE.model_capped,
        overallRank: 0,
        positionRank: 0,
        trend30d: null,
        tier: null,
      };
    }

    const seam = position === null ? undefined : caps.get(position);
    const clamped = seam === undefined ? fitted : softCap(fitted, seam);
    const injured = clamped * injuryMultiplier(player.injuryStatus);

    return {
      ...base,
      value: Math.max(FLOOR_VALUE, Math.round(injured)),
      baseValue,
      source: "model" as const,
      confidence: isExtrapolated(fit, player.vor)
        ? EXTRAPOLATED_CONFIDENCE
        : CONFIDENCE.model,
      overallRank: 0,
      positionRank: 0,
      trend30d: null,
      tier: null,
    };
  });

  rows.sort(compare);

  const positionCounts = new Map<string, number>();
  const bySource: Record<ValueSource, number> = {
    market: 0,
    model: 0,
    model_capped: 0,
    floor: 0,
  };

  rows.forEach((row, index) => {
    row.overallRank = index + 1;

    const position = row.position ?? "UNK";
    const rank = (positionCounts.get(position) ?? 0) + 1;
    positionCounts.set(position, rank);
    row.positionRank = rank;

    bySource[row.source] += 1;
  });

  const seamViolations = rows.filter((row) => {
    if (row.source !== "model" || row.position === null) return false;
    const seam = caps.get(row.position);
    return seam !== undefined && row.value > seam;
  }).length;

  return {
    rows,
    bySource,
    overlap,
    rankCorrelation,
    seamViolations,
    baselines,
    replacementRanks: replacementRanks(config.rosterSlots, config.numTeams),
    kdefCap: cap,
  };
}

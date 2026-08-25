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
 * The lowest market-priced value at a position. Tier B is clamped here so a
 * waiver flyer can never leapfrog a rostered starter the market has priced —
 * the first of §5's three guardrails, and the one §13 checks for.
 */
function seamCaps(players: EnginePlayer[]): Map<string, number> {
  const caps = new Map<string, number>();

  for (const player of players) {
    if (!player.market) continue;
    const position = normalizePosition(player.position);
    if (!position) continue;

    const current = caps.get(position);
    if (current === undefined || player.market.value < current) {
      caps.set(position, player.market.value);
    }
  }

  return caps;
}

/**
 * §5's second guardrail. Kickers and defenses have no market anchor and VOR
 * flatters them badly — they score consistently, so their spread above
 * replacement reads as reliability rather than scarcity. Measured against the
 * live board, the raw fit puts the best kicker at ~3,200, which would rank him
 * inside the top 20 assets in the league.
 *
 * The ceiling is the market's own floor: the cheapest player FantasyCalc is
 * willing to price at all. This is §13's seam check generalized to a position
 * the market declines to cover — if the market says the 190th-best skill
 * player is worth 3, a streamed kicker is not worth more than that.
 *
 * §5 suggests the QB2/TE2 tier for this ceiling; on the real curve that is
 * ~136, which would rank every kicker above all 365 modelled skill players.
 * §3 is the sharper statement of the same intent and the one followed here:
 * in redraft their trade value "genuinely *is* near zero."
 */
export function kdefCap(players: EnginePlayer[]): number {
  let floor = Infinity;

  for (const player of players) {
    if (player.market && player.market.value < floor) floor = player.market.value;
  }

  if (!Number.isFinite(floor)) return DEFAULT_KDEF_CAP;
  return Math.max(FLOOR_VALUE, Math.round(floor));
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

  // Ties are the norm below the seam, not the exception: FantasyCalc's own
  // curve bottoms out at 1, so the clamp legitimately flattens most of the
  // model tier onto that floor. The values are telling the truth — those
  // players really are worth about nothing in trade — but the *ordering* still
  // has to mean something, and VOR is what it means.
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
  const cap = kdefCap(players);

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
      return {
        ...base,
        value: Math.max(FLOOR_VALUE, Math.min(baseValue, cap)),
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
    const clamped = seam === undefined ? fitted : Math.min(fitted, seam);
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

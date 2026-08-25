/**
 * §7's waiver ranking, as a pure function of projections and the needs vector.
 *
 * ```
 * score = ros_projected_points(p) × (1 + λ × need(position(p)))
 * ```
 *
 * The ordering is the argument. §7 is emphatic that free agents rank on
 * rest-of-season projection and *not* on estimated trade value: they sit almost
 * entirely below FantasyCalc's coverage, so sorting them by value would mean
 * sorting on an estimate of a number that is near zero for every one of them —
 * noise amplified into a ranking. Projections are the real signal here and
 * Sleeper has them for effectively all of these players. "Who should I add" is
 * a projection question, not a market question.
 *
 * Values still ride along on every row, always with §5's provenance badge, for
 * continuity with the rest of the app. They just do not drive the order.
 *
 * No `server-only` and no transport: the λ slider re-ranks the board in the
 * browser, the same way §6's knobs re-price a trade.
 */

/** §8's schema default, and the one §7 writes the formula against. */
export const DEFAULT_LAMBDA = 0.5;

/**
 * The slider's range, narrower than the database's `between 0 and 5`.
 *
 * λ multiplies a z-score, and a z-score is unbounded. At λ = 1 a team one full
 * standard deviation thin at a position doubles every free agent there, which
 * is already an aggressive reading of "weight the wire toward your needs"; past
 * about 1.5 the need term drowns the projection entirely and the board stops
 * being a ranking of players and starts being a ranking of positions. The check
 * constraint stays loose so a future phase can want more without a migration.
 */
export const LAMBDA_LIMITS = { min: 0, max: 1.5, step: 0.05 };

/**
 * How far from average the need term is allowed to read.
 *
 * Beyond one standard deviation the *direction* is established and the extra
 * magnitude is mostly the tail of a twelve-sample estimate — a league with one
 * catastrophic roster can push a z past 3, and letting that through would triple
 * a kicker. Clamping keeps the multiplier inside `[1 − λ, 1 + λ]`, which is a
 * range a user can reason about while dragging the slider.
 */
export const NEED_CLAMP = 1;

/** The only facts the ranking reads off a free agent. */
export type WaiverCandidate = {
  playerId: number;
  position: string | null;
  /** Rest-of-season projected points. Null means unrankable, not zero. */
  rosPoints: number | null;
};

export type WaiverPick<T extends WaiverCandidate = WaiverCandidate> = {
  candidate: T;
  /** `1 + λ × need`, clamped. 1 exactly when λ is 0 or the need is average. */
  multiplier: number;
  /** The need this position carried, as it was used — already clamped. */
  need: number;
  score: number;
};

/**
 * `1 + λ × need`, floored at zero.
 *
 * The floor is a guard rather than a judgement: with the clamps above it can
 * only bind at λ > 1, and a negative multiplier would invert the ranking — the
 * best free agent at a position you are deep in would sort *below* the worst,
 * which is not a stronger version of "you do not need one", it is nonsense.
 */
export function needMultiplier(need: number, lambda: number): number {
  const clamped = Math.min(NEED_CLAMP, Math.max(-NEED_CLAMP, need));
  return Math.max(0, 1 + lambda * clamped);
}

/**
 * Ranks a free-agent pool for one team.
 *
 * Generic over the candidate so the caller's richer row — name, value,
 * provenance, injury — survives the trip through the math and comes back out
 * attached to its score, exactly as `analyzeTrade` carries a trade asset.
 *
 * A candidate with no projection is dropped rather than scored at zero. §7
 * ranks on projections, so a player with none has nothing to be ranked by;
 * scoring them at zero would bury them under every kicker while implying the
 * app had looked and found nothing there, which is a different claim.
 */
export function rankWaivers<T extends WaiverCandidate>(
  candidates: T[],
  needs: Map<string, number>,
  lambda: number = DEFAULT_LAMBDA,
): WaiverPick<T>[] {
  const picks: WaiverPick<T>[] = [];

  for (const candidate of candidates) {
    if (candidate.rosPoints === null) continue;

    const raw = candidate.position ? (needs.get(candidate.position) ?? 0) : 0;
    const need = Math.min(NEED_CLAMP, Math.max(-NEED_CLAMP, raw));
    const multiplier = needMultiplier(raw, lambda);

    picks.push({
      candidate,
      multiplier,
      need,
      score: candidate.rosPoints * multiplier,
    });
  }

  return picks.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // A tie on the weighted score is broken on the raw projection, so the
    // ordering degrades to §7's underlying signal rather than to insertion
    // order — which matters most at λ = 0, where every score is the projection.
    const points = (b.candidate.rosPoints ?? 0) - (a.candidate.rosPoints ?? 0);
    if (points !== 0) return points;
    return a.candidate.playerId - b.candidate.playerId;
  });
}

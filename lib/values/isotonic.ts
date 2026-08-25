/**
 * Isotonic regression, by pool-adjacent-violators (§5).
 *
 * The job is to bridge two scales: VOR is in fantasy points, FantasyCalc is in
 * market units, and the only thing tying them together is the ~192 players
 * that have both. A linear fit would badly overvalue the middle of the board,
 * because FantasyCalc's curve is steeply convex at the top — its top 100 hold
 * 92.3% of all league value. Isotonic makes no shape assumption at all beyond
 * the one that actually matters: a better projection never earns a lower
 * value.
 */

export type FitPoint = { x: number; y: number; weight?: number };

/** A step function, stored as the breakpoints PAVA collapsed the data into. */
export type IsotonicFit = {
  xs: number[];
  ys: number[];
  /** How many observations the fit was built from. */
  samples: number;
};

/**
 * Fits a non-decreasing y = f(x). Points are pooled left to right and any
 * block that dips below its predecessor is merged into it and replaced by the
 * pooled mean, which is what makes the result monotone by construction rather
 * than by clamping afterwards.
 */
export function fitIsotonic(points: FitPoint[]): IsotonicFit {
  const usable = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (usable.length === 0) return { xs: [], ys: [], samples: 0 };

  const sorted = [...usable].sort((a, b) => a.x - b.x);

  // Ties on x must be pooled before the sweep: two players with the same VOR
  // cannot be given different values, so they enter as one observation.
  type Block = { x: number; sum: number; weight: number };
  const blocks: Block[] = [];

  for (const point of sorted) {
    const weight = point.weight ?? 1;
    const last = blocks[blocks.length - 1];

    if (last && last.x === point.x) {
      last.sum += point.y * weight;
      last.weight += weight;
      continue;
    }

    blocks.push({ x: point.x, sum: point.y * weight, weight });
  }

  const pooled: Block[] = [];
  for (const block of blocks) {
    pooled.push({ ...block });

    while (pooled.length > 1) {
      const right = pooled[pooled.length - 1];
      const left = pooled[pooled.length - 2];
      if (left.sum / left.weight <= right.sum / right.weight) break;

      pooled.pop();
      // The merged block keeps the right edge's x: the step it represents runs
      // up to that x, which is where prediction interpolates from.
      left.x = right.x;
      left.sum += right.sum;
      left.weight += right.weight;
    }
  }

  return {
    xs: pooled.map((block) => block.x),
    ys: pooled.map((block) => block.sum / block.weight),
    samples: usable.length,
  };
}

/**
 * Evaluates the fit, interpolating between breakpoints and holding flat
 * outside the observed range. Extrapolating past either end would be inventing
 * market data where none exists — the low end is exactly where Tier B players
 * live, and the guardrails in §5 are what handle them instead.
 */
export function predictIsotonic(fit: IsotonicFit, x: number): number {
  if (fit.xs.length === 0) return 0;
  if (fit.xs.length === 1 || x <= fit.xs[0]) return fit.ys[0];
  if (x >= fit.xs[fit.xs.length - 1]) return fit.ys[fit.ys.length - 1];

  let low = 0;
  let high = fit.xs.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (fit.xs[mid] <= x) low = mid;
    else high = mid;
  }

  const span = fit.xs[high] - fit.xs[low];
  if (span === 0) return fit.ys[high];
  return fit.ys[low] + ((x - fit.xs[low]) / span) * (fit.ys[high] - fit.ys[low]);
}

/** True when `x` sits outside the range the fit was built from. */
export function isExtrapolated(fit: IsotonicFit, x: number): boolean {
  if (fit.xs.length === 0) return true;
  return x < fit.xs[0] || x > fit.xs[fit.xs.length - 1];
}

/** Tie-aware ranks, ascending, 1-based — average rank within each tie group. */
function averageRanks(values: number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;

    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k].index] = rank;
    i = j + 1;
  }

  return ranks;
}

/**
 * Spearman rank correlation. §13 wants the fit's agreement with FantasyCalc on
 * the overlap set to be ≥ 0.98; since an isotonic fit is monotone in its input,
 * this is really asking whether the VOR inputs rank players the way the market
 * does. A low number means the projections or the replacement levels are
 * wrong, not that the regression is.
 */
export function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;

  const rx = averageRanks(xs);
  const ry = averageRanks(ys);
  const n = rx.length;
  const meanX = rx.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ry.reduce((sum, value) => sum + value, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (let i = 0; i < n; i += 1) {
    const dx = rx[i] - meanX;
    const dy = ry[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

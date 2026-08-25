/**
 * §7's needs vector, as a pure function of a league's rosters.
 *
 * ```
 * starters(p)   = top k_p players by projection at position p
 * strength(p)   = Σ projections of starters(p)
 * z(p)          = (strength(p) − league_mean(p)) / league_sd(p)
 * need(p)       = −z(p)              positive ⇒ weakness
 * surplus(p)    = Σ projections of players above the starter requirement
 * ```
 *
 * §7 calls this "the single structure [that] drives all four remaining
 * features", which is why it is computed once per sync and cached — and why it
 * is a pure module with no transport and no `server-only`, the way
 * `lib/values/vor.ts` and `lib/trades/analyze.ts` are. Phases 8 and 9 optimize
 * against these numbers; a bug in here is a bug in every suggestion they make.
 *
 * Everything is a fold over one league. A z-score against the whole NFL would
 * be a different and much less useful claim: what makes a position a *need* is
 * that the eleven managers you play against are better there than you are.
 */
import { normalizePosition } from "@/lib/crosswalk/resolve";
import { starterCounts, type StartingSlot } from "@/lib/values/vor";

/**
 * The six positions a needs vector is computed over.
 *
 * VOR stops at the four scoring positions because §5's replacement-level
 * arithmetic has nothing to say about a position every team starts exactly one
 * of and streams. Needs are the opposite case: kickers and defenses are
 * *precisely* where the waiver wire does its work in redraft, and §7's whole
 * argument for ranking the wire on projection rather than trade value applies
 * to them most of all. A league where every team's kicker is interchangeable
 * produces a flat axis, which is the honest reading rather than a missing one.
 */
export const NEED_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type NeedPosition = (typeof NEED_POSITIONS)[number];

export function isNeedPosition(position: string | null): position is NeedPosition {
  return (
    position !== null && (NEED_POSITIONS as readonly string[]).includes(position)
  );
}

/** The only facts the needs math reads off a player. */
export type NeedsPlayer = {
  playerId: number;
  position: string | null;
  /**
   * Rest-of-season projected points — §5's blend, scaled by weeks remaining.
   *
   * Null is not zero. A player with no projection is exactly §5's `floor`
   * tier — no market price and nothing to model from — so they are counted
   * against `confidence` rather than silently summed as nothing.
   */
  points: number | null;
};

export type NeedsRoster = {
  teamId: string;
  players: NeedsPlayer[];
};

export type TeamNeed = {
  teamId: string;
  position: NeedPosition;
  strength: number;
  zScore: number;
  /** `−z`. Positive is a weakness, which is the sign §7's waiver score wants. */
  need: number;
  surplus: number;
  /** Surplus on the same cross-team scale as `zScore`, so positions compare. */
  surplusZ: number;
  /** Share of this team's players at the position that carry a projection. */
  confidence: number;
  /** How many did not — the players this row could not see. */
  unprojected: number;
};

export type NeedsReport = {
  rows: TeamNeed[];
  /** `k_p`: starting slots per team at each position, flex distributed. */
  starters: Record<NeedPosition, number>;
  teams: number;
  /** Rostered players in the whole league with no projection to fold in. */
  unprojected: number;
};

/**
 * Below this the league has no spread at a position and there is nothing to
 * measure a team against. Relative to the mean rather than absolute, because
 * strength is in fantasy points and "identical" is a float comparison: twelve
 * teams that really do have the same projected starters produce a standard
 * deviation of about 1e-13, not 0.
 */
const SPREAD_EPSILON = 1e-9;

/**
 * Starting slots per team at each of the six positions.
 *
 * The four scoring positions come from `starterCounts`, which already
 * distributes each flex slot across the positions that fill it — so a standard
 * W/R/T league counts 2.5 running backs rather than 2, and the half is the
 * third-best one. K and DEF are added here because no flex slot has ever
 * accepted them, so they are simply their own count.
 */
export function needStarterCounts(
  slots: StartingSlot[],
): Record<NeedPosition, number> {
  const scoring = starterCounts(slots);
  const counts: Record<NeedPosition, number> = {
    QB: scoring.QB,
    RB: scoring.RB,
    WR: scoring.WR,
    TE: scoring.TE,
    K: 0,
    DEF: 0,
  };

  for (const slot of slots) {
    if (!slot.isStarting || slot.count <= 0) continue;
    const position = normalizePosition(slot.position);
    if (position === "K" || position === "DEF") counts[position] += slot.count;
  }

  return counts;
}

export type StarterSplit = {
  /** Σ of the top `k`, with the marginal player counted fractionally. */
  strength: number;
  /** Everything behind them. `strength + surplus` is the position's total. */
  surplus: number;
};

/**
 * Splits a position's projections into starters and depth at a possibly
 * fractional starter count.
 *
 * `k_p` is fractional by construction — a shared flex slot is genuinely half a
 * running back — so the marginal player is counted for the fraction of the
 * time the slot is theirs, exactly as `baselineAt` interpolates a fractional
 * replacement rank in §5. The alternative, rounding `k_p`, makes the third RB
 * either free or worthless and moves a team's strength by a whole player for a
 * slot that half exists.
 */
export function splitStarters(
  pointsDescending: number[],
  k: number,
): StarterSplit {
  const total = pointsDescending.reduce((sum, points) => sum + points, 0);
  if (k <= 0) return { strength: 0, surplus: total };

  const whole = Math.min(pointsDescending.length, Math.floor(k));
  let strength = 0;
  for (let index = 0; index < whole; index += 1) {
    strength += pointsDescending[index];
  }

  const fraction = k - Math.floor(k);
  if (fraction > 0 && whole < pointsDescending.length) {
    strength += fraction * pointsDescending[whole];
  }

  // Floating-point subtraction can leave a surplus of −1e-13 on a roster with
  // no depth at all, and a negative surplus is a claim nobody should have to
  // read.
  return { strength, surplus: Math.max(0, total - strength) };
}

/**
 * Standard scores over every team in the league, with the degenerate case
 * answered rather than divided by.
 *
 * Population standard deviation, not sample: these are all twelve teams, not
 * twelve teams drawn from somewhere larger. A league where every roster is
 * identical has a spread of zero, and the honest z is 0 for everyone — every
 * team *is* exactly average. Dividing by zero would say something far
 * stronger, and `Infinity` would poison every consumer downstream.
 */
export function zScores(values: number[]): number[] {
  if (values.length === 0) return [];

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);

  if (sd <= SPREAD_EPSILON * Math.max(1, Math.abs(mean))) {
    return values.map(() => 0);
  }

  return values.map((value) => (value - mean) / sd);
}

type Bucket = {
  points: number[];
  unprojected: number;
  total: number;
};

function bucket(players: NeedsPlayer[]): Map<NeedPosition, Bucket> {
  const buckets = new Map<NeedPosition, Bucket>();
  for (const position of NEED_POSITIONS) {
    buckets.set(position, { points: [], unprojected: 0, total: 0 });
  }

  for (const player of players) {
    const position = normalizePosition(player.position);
    if (!isNeedPosition(position)) continue;

    // Non-null assertion avoided: every need position was seeded above.
    const entry = buckets.get(position);
    if (!entry) continue;

    entry.total += 1;
    if (player.points === null) entry.unprojected += 1;
    else entry.points.push(player.points);
  }

  for (const entry of buckets.values()) {
    entry.points.sort((a, b) => b - a);
  }

  return buckets;
}

/**
 * The needs vector for every team in a league.
 *
 * Every team gets a row at every one of the six positions, including the ones
 * they have nobody at — an empty position is a strength of 0 measured against
 * eleven teams that have somebody, which is the largest need the structure can
 * express and precisely the thing Requirement 7 is asking about. A position
 * the league starts nobody at (`k_p = 0`) gives every team a strength of 0,
 * which has no spread, which resolves to a need of 0: there is nothing to be
 * weak at.
 *
 * Rosters are read whole, starters and bench alike. Strength measures what a
 * team *has* at a position, not what its manager happened to slot this week.
 */
export function computeNeeds(
  rosters: NeedsRoster[],
  slots: StartingSlot[],
): NeedsReport {
  const starters = needStarterCounts(slots);
  const buckets = rosters.map((roster) => ({
    teamId: roster.teamId,
    positions: bucket(roster.players),
  }));

  const rows: TeamNeed[] = [];
  let unprojected = 0;

  for (const position of NEED_POSITIONS) {
    const splits = buckets.map((team) => {
      const entry = team.positions.get(position) ?? {
        points: [],
        unprojected: 0,
        total: 0,
      };
      return { team, entry, split: splitStarters(entry.points, starters[position]) };
    });

    const strengthZ = zScores(splits.map(({ split }) => split.strength));
    const surplusZ = zScores(splits.map(({ split }) => split.surplus));

    splits.forEach(({ team, entry, split }, index) => {
      unprojected += entry.unprojected;
      const z = strengthZ[index];

      rows.push({
        teamId: team.teamId,
        position,
        strength: split.strength,
        zScore: z,
        // Negating a zero produces `-0`, which is the same number and a
        // different string. A league with no spread at a position should read
        // "0", not "−0", everywhere from the card to the database.
        need: z === 0 ? 0 : -z,
        surplus: split.surplus,
        surplusZ: surplusZ[index],
        // Nothing unseen at a position nobody is rostered at: a strength of 0
        // built out of no players is exactly right, not an estimate.
        confidence:
          entry.total === 0 ? 1 : (entry.total - entry.unprojected) / entry.total,
        unprojected: entry.unprojected,
      });
    });
  }

  return { rows, starters, teams: rosters.length, unprojected };
}

// ---------------------------------------------------------------------------
// reading a needs vector back
// ---------------------------------------------------------------------------

/**
 * §10's headline number for a team card: the flex-weighted sum of what it
 * starts.
 *
 * Σ strength over the positions is the same quantity as an optimal starting
 * lineup, approached from the other side — `k_p` sums to the number of
 * starting slots, so summing the top `k_p` at each position spends every slot
 * exactly once. It is an approximation rather than the optimum because a flex
 * slot is charged half to RB and 0.4 to WR instead of being handed to whoever
 * actually scores most; `bestLineup` in `./lineup` solves that properly, and
 * is what the trade page's roster-context delta uses. This one needs no roster,
 * only the cached vector, which is what makes a twelve-card grid one read.
 */
export function startingStrength(rows: TeamNeed[]): number {
  return rows.reduce((sum, row) => sum + row.strength, 0);
}

/** The positions this team is weakest at, largest need first. */
export function topNeeds(rows: TeamNeed[], count = 2): TeamNeed[] {
  return [...rows]
    .filter((row) => row.need > 0)
    .sort((a, b) => b.need - a.need)
    .slice(0, count);
}

/**
 * The positions this team can trade out of, deepest first — ranked on
 * `surplusZ` rather than raw points, because a quarterback outscores a tight
 * end for reasons that have nothing to do with depth.
 */
export function topSurpluses(rows: TeamNeed[], count = 2): TeamNeed[] {
  return [...rows]
    .filter((row) => row.surplusZ > 0 && row.surplus > 0)
    .sort((a, b) => b.surplusZ - a.surplusZ)
    .slice(0, count);
}

/**
 * How far from average a z-score is worth drawing, and the radius it maps to.
 *
 * Two standard deviations covers ~95% of a normal spread; past that the axis
 * pins rather than escaping the chart. The floor keeps the weakest team's axis
 * visible — a radar with a vertex at the origin reads as missing data rather
 * than as a weakness.
 */
export const RADAR_Z_RANGE = 2;
export const RADAR_MIN_RADIUS = 0.16;

/** A z-score as a 0–1 radius on the overview's radar. */
export function radarRadius(zScore: number): number {
  const clamped = Math.min(RADAR_Z_RANGE, Math.max(-RADAR_Z_RANGE, zScore));
  const share = (clamped + RADAR_Z_RANGE) / (2 * RADAR_Z_RANGE);
  return RADAR_MIN_RADIUS + share * (1 - RADAR_MIN_RADIUS);
}

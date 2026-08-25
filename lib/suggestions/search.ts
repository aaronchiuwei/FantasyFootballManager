/**
 * §7's two suggestion engines, as one pure module: the win-win search
 * (Requirement 9) and the player-based builder (Requirement 10).
 *
 * Nothing here is new arithmetic. A suggestion is a *candidate* handed to two
 * scorers that already exist and are already tested — `analyzeTrade` for §6's
 * fairness verdict and `lineupChangeFrom` for §6's roster-context delta — so a
 * package this file proposes and the analyzer then calls unfair would be a bug
 * rather than a disagreement. The search is candidate generation, pruning and
 * ranking on top of math the app already trusts.
 *
 * No `server-only` and no transport, for the reason `analyze.ts`, `needs.ts`
 * and `score.ts` have none: the builder re-runs in a server action over the
 * same board the browser is holding, and both sides have to be running the same
 * function. The win-win half is cached by sync stage 8 (§9) because it is a
 * fold over every pair of rosters in the league; the builder half is not,
 * because its input is a player the user just named.
 *
 * A note on the numbering, since this file leans on it hard. Both engines are
 * specified inside plan §7, in subsections it labels by *requirement* number —
 * so "§9" here means §7's win-win subsection, the way `analyze.ts` already uses
 * it, and "§10" means its player-based-builder subsection except where it is
 * plainly the UI section being quoted.
 *
 * ---------------------------------------------------------------------------
 * The search space, stated plainly
 * ---------------------------------------------------------------------------
 *
 * §9 sizes it and this module holds to that size:
 *
 * ```
 * per team       C(8,1) + C(8,2)            =    36 packages
 * per pair       36 × 36                    = 1,296 candidate trades
 * 12-team league C(12,2) × 1,296            ≈ 85,536
 * ```
 *
 * Three bounds make that number the whole story rather than the start of one:
 *
 * 1. **Top 8 assets per team**, ranked by value tilted toward the positions
 *    §7's needs vector says the team is deep at. Eight is §9's own number and
 *    it is not arbitrary — a redraft roster has about eight players anyone
 *    would ask for, and the ninth is a throw-in whose presence in a package is
 *    decided by the depth penalty rather than by the search.
 * 2. **Two players per side.** §9 enumerates 1-for-1, 2-for-1 and 2-for-2.
 *    Allowing three would take a pair from 1,296 to 8,464 — a 6.5× bill for
 *    packages §6's `beta` is explicitly there to discourage.
 * 3. **An exact value-window prune** (`baseRatioWindow`) that skips pairs of
 *    packages whose raw sums cannot possibly land inside the fairness band
 *    whatever the bonus math does to them. Exact meaning it never discards a
 *    candidate that would have survived — it is a bound on §6's adjustments,
 *    not a heuristic — so the result is identical to the exhaustive search and
 *    only the cost differs.
 *
 * The builder's space is smaller and shaped differently: one fixed target on
 * the other side, and `C(12,1) + C(12,2) + C(12,3) = 298` subsets of the user's
 * own tradeable pieces.
 *
 * Phase 9's three-team cycle is deliberately not here. §7 calls its
 * combinatorics "a real trap" and says to ship it only after 9 and 10 are
 * solid; the seam it needs is `SuggestionTeam` plus `compareSuggestions`, both
 * of which already generalize past two teams.
 */
import { normalizePosition } from "@/lib/crosswalk/resolve";
import {
  bestLineup,
  lineupChangeFrom,
  type Lineup,
  type LineupChange,
  type LineupPlayer,
} from "@/lib/needs/lineup";
import {
  analyzeTrade,
  BAND_THRESHOLDS,
  DEFAULT_TRADE_PARAMS,
  type TradeAnalysis,
  type TradeAsset,
  type TradeParams,
} from "@/lib/trades/analyze";
import { isTradeAsset } from "@/lib/values/engine";
import type { StartingSlot } from "@/lib/values/vor";

/**
 * One asset, as both scorers need to see it.
 *
 * The intersection is the point: the search runs §6's value math and §7's
 * lineup math over the *same* package, so an asset that satisfied only one of
 * them would have to be re-projected into the other on every candidate — tens
 * of thousands of times. The caller pays that conversion once, on the way in.
 */
export type SuggestionAsset = TradeAsset &
  LineupPlayer & {
    /** A player can only be sent by the team that rosters them. */
    teamId: string;
  };

/**
 * A team as the search sees it: a roster, and the two halves of §7's needs
 * vector that decide which of its players are worth putting on the table.
 */
export type SuggestionTeam<T extends SuggestionAsset = SuggestionAsset> = {
  teamId: string;
  roster: T[];
  /** §7's `surplusZ` by position — §9 weights the candidate list toward it. */
  surplusZ: Record<string, number>;
  /** §7's `need` by position — §10 keeps the user's pieces out of it. */
  need: Record<string, number>;
};

// ---------------------------------------------------------------------------
// the bounds
// ---------------------------------------------------------------------------

export const WIN_WIN_LIMITS = {
  /** §9: "each side's top ~8 tradeable assets weighted toward surplus positions". */
  topAssets: 8,
  /** §9 enumerates 1-for-1, 2-for-1 and 2-for-2 — never deeper. */
  maxPackage: 2,
  /** How many survive per pair. Three is a menu; one is an oracle. */
  perPair: 3,
} as const;

export const BUILDER_LIMITS = {
  /** §10: "subsets of the user's roster of size ≤ 3". */
  maxPackage: 3,
  /** §10: "return 3–5 alternative packages rather than one answer". */
  results: 5,
  /**
   * How many of the user's pieces enter the enumeration. Twelve rather than
   * eight because the builder has already been told what the user wants and
   * can afford to look further down their own roster for the price of it —
   * 298 subsets against the win-win search's 36 packages.
   */
  topAssets: 12,
} as const;

/**
 * Fair by value, and it is the same line the rest of the app draws. §9 says
 * "filter to `pct < 8%`"; §6's bands call that everything up to and including
 * a slight edge, and the README already explains that the 8% boundary is where
 * the verdict's color changes for exactly this reason.
 *
 * §10 writes its own window instead — subsets landing in `[0.95, 1.10] ×` the
 * target's total — and that upper end is a trap: a package worth 1.10× what it
 * is being traded for scores `pct = 9.1%`, which the analyzer calls a **clear
 * winner**. Suggesting a trade the app's own verdict panel then argues against
 * is the specific bug this phase was told to avoid, so the band wins and §10's
 * window loses. The asymmetry §10 was reaching for — that you may pay a little
 * over to get the player you actually want — survives in the ranking instead.
 */
export const FAIR_BAND = BAND_THRESHOLDS.slight;

/**
 * How hard the candidate list leans toward a position the team is deep at.
 *
 * Written in the shape §7's waiver score already uses — `value × (1 + σ × z)`,
 * on a z clamped to ±1 — because it is the same claim in the other direction:
 * the wire tilts toward what a roster lacks, and the trade table tilts toward
 * what it can spare. The clamp is there for the reason §7 gives: past one
 * standard deviation the direction is established and the magnitude is mostly
 * the tail of a twelve-sample estimate.
 *
 * 0.35 is deliberately gentle. Surplus decides *ordering* among assets of
 * similar price; it must not let a team's fourth-best running back outrank a
 * genuine star just because the star plays a thin position, because the star is
 * still the asset the other manager wants to talk about.
 */
export const SURPLUS_TILT = 0.35;
export const SURPLUS_CLAMP = 1;

/**
 * How thin a position has to read before §10 stops spending the user's players
 * at it.
 *
 * §10 says "exclude players at positions of need", and taken literally — any
 * `need > 0` — that empties roughly half of every roster by construction:
 * `need` is a z-score against the league, so half the league is on the wrong
 * side of average at every position, including teams that are perfectly fine
 * there. Half a standard deviation is the point at which the vector is making
 * a claim rather than reporting noise, and it leaves the user a roster to
 * build from.
 */
export const NEED_EXCLUSION_Z = 0.5;

/**
 * Below this a lineup has not improved, it has jittered.
 *
 * Rest-of-season projections are sums of floats over a dozen players; two
 * lineups that differ by a thousandth of a point are the same lineup. §9's
 * win-win test is that *both* sides gain, and a gain nobody could measure is
 * not one.
 */
export const MIN_LINEUP_GAIN = 0.05;

/**
 * The tolerance the ranking treats two numbers as equal at.
 *
 * Same argument, applied to the comparator: two packages whose minimum gain
 * differs in the twelfth decimal are the same package as far as a manager is
 * concerned, and comparing them exactly would let floating-point dust decide
 * which one the user sees first — a different order on every sync, for no
 * reason anybody could point at.
 */
export const TIE_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// candidate generation
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * What an asset is worth *putting on the table*, as distinct from what it is
 * worth. Value, tilted by how much of it the team can spare (§9).
 */
export function tradeability(
  asset: SuggestionAsset,
  surplusZ: Record<string, number>,
): number {
  const position = normalizePosition(asset.position);
  const z = position === null ? 0 : (surplusZ[position] ?? 0);
  return asset.value * (1 + SURPLUS_TILT * clamp(z, -SURPLUS_CLAMP, SURPLUS_CLAMP));
}

export type CandidateSet<T extends SuggestionAsset> = {
  assets: T[];
  /** §4: rostered players with no resolved value, which is why they are absent. */
  unvalued: number;
  /** §3: kickers and defenses, which are streamed rather than traded. */
  nonTradeable: number;
};

/**
 * The assets a team could realistically put in a package, best first.
 *
 * Two exclusions, and they are not the same kind of exclusion:
 *
 * - **`floor` values are dropped.** §4's rule is that the analyzer refuses a
 *   verdict on a package containing one, so every candidate built from such a
 *   player is blocked before it is scored. Generating them would spend the
 *   search's whole budget producing trades that cannot be suggested. The count
 *   comes back with the set, because "we did not look at these" is a claim the
 *   user is owed rather than a detail to swallow (§4, §5).
 * - **Kickers and defenses are dropped.** §3: in redraft their trade value
 *   genuinely is near zero, the value engine prices them at the market's own
 *   floor, and a package built around one is not a trade anybody would send.
 *   The analyzer flags them rather than blocking them, which is right for a
 *   deal a human assembled and wrong for one a search invented.
 */
export function candidateAssets<T extends SuggestionAsset>(
  team: SuggestionTeam<T>,
  topAssets: number,
  { exclude }: { exclude?: (asset: T) => boolean } = {},
): CandidateSet<T> {
  let unvalued = 0;
  let nonTradeable = 0;

  const eligible: T[] = [];
  for (const asset of team.roster) {
    if (asset.source === "floor") {
      unvalued += 1;
      continue;
    }
    if (!isTradeAsset(asset.position)) {
      nonTradeable += 1;
      continue;
    }
    if (exclude?.(asset)) continue;
    eligible.push(asset);
  }

  eligible.sort((a, b) => {
    const delta = tradeability(b, team.surplusZ) - tradeability(a, team.surplusZ);
    if (Math.abs(delta) > TIE_EPSILON) return delta;
    // Ties fall back to raw value and then to the id, so the same roster
    // always produces the same eight candidates.
    if (b.value !== a.value) return b.value - a.value;
    return a.playerId - b.playerId;
  });

  return { assets: eligible.slice(0, topAssets), unvalued, nonTradeable };
}

export type AssetPackage<T extends SuggestionAsset> = {
  assets: T[];
  /** Σ value, before any of §6's adjustments — what the prune is bounded on. */
  base: number;
};

/**
 * Every non-empty subset of `assets` up to `maxSize`, each carrying its own raw
 * sum, sorted ascending by that sum so `baseRatioWindow` can binary-search it.
 */
export function enumeratePackages<T extends SuggestionAsset>(
  assets: T[],
  maxSize: number,
): AssetPackage<T>[] {
  const packages: AssetPackage<T>[] = [];

  const walk = (start: number, chosen: T[], base: number) => {
    if (chosen.length > 0) packages.push({ assets: [...chosen], base });
    if (chosen.length === maxSize) return;

    for (let index = start; index < assets.length; index += 1) {
      chosen.push(assets[index]);
      walk(index + 1, chosen, base + assets[index].value);
      chosen.pop();
    }
  };

  walk(0, [], 0);
  packages.sort((a, b) => a.base - b.base);
  return packages;
}

/**
 * The multiplicative window a package's raw sum has to fall inside for the
 * other side's raw sum to have any chance of landing in the fairness band.
 *
 * Derived rather than tuned, which is what makes the prune exact. For a side
 * of `n ≤ maxPackage` assets with raw sum `B`, §6's adjustments are each
 * bounded by a share of `B` — the best asset is worth at most `B`, so is the
 * median, and the headline premium is charged on a margin no larger than the
 * best asset:
 *
 * ```
 * total ∈ [ B × (1 − β(n−1)) , B × (1 + α + γ) ]   =   [B·lo, B·hi]
 * ```
 *
 * Fairness needs `min(Ta, Tb) ≥ max(Ta, Tb) × (1 − band)`. Substituting the
 * loosest totals each base could produce gives a necessary condition on the
 * bases alone:
 *
 * ```
 * Bb ≥ Ba × lo(1 − band)/hi        and        Bb ≤ Ba × hi/(lo(1 − band))
 * ```
 *
 * On §6's defaults with two-player packages that is roughly `[0.79, 1.27] × Ba`
 * — wide enough to be obviously safe, narrow enough to throw away most of a
 * roster whose values span two orders of magnitude. Nothing inside the window
 * is assumed fair; everything outside it is *proved* unfair without running the
 * analyzer, which is the only kind of pruning worth doing when the analyzer is
 * the definition of the answer.
 */
export function baseRatioWindow(
  params: TradeParams,
  maxPackage: number,
  band: number = FAIR_BAND,
): { lo: number; hi: number } {
  const worstPenalty = Math.max(0, params.beta * Math.max(0, maxPackage - 1));
  const lo = Math.max(TIE_EPSILON, 1 - worstPenalty);
  const hi = 1 + Math.max(0, params.alpha) + Math.max(0, params.gamma);

  const ratio = (lo * (1 - band)) / hi;
  return { lo: ratio, hi: 1 / ratio };
}

/**
 * Bisection over a list sorted ascending by base. `strict` picks which side of
 * an exact hit the boundary falls on: the window is closed at both ends,
 * because the bound it comes from is an inequality on `≤` and a package sitting
 * exactly on it has not been proved unfair.
 */
function bound<T extends SuggestionAsset>(
  packages: AssetPackage<T>[],
  target: number,
  strict: boolean,
): number {
  let low = 0;
  let high = packages.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const before = strict
      ? packages[middle].base <= target
      : packages[middle].base < target;
    if (before) low = middle + 1;
    else high = middle;
  }

  return low;
}

// ---------------------------------------------------------------------------
// what a suggestion is
// ---------------------------------------------------------------------------

export type SuggestionScore = {
  /** §9's objective: `min(Δlineup_A, Δlineup_B)`, in projected points. */
  minGain: number;
  /** `Δlineup_A + Δlineup_B` — how much the deal creates in total. */
  totalGain: number;
  /** Share of the value on the table that carries a market price (§5). */
  marketShare: number;
  /** §6's `|Δ| / max(total)`. Inside `FAIR_BAND` by construction. */
  pct: number;
  /** Players moving. Roster spots are finite, so fewer is a tiebreak. */
  bodies: number;
};

export type Suggestion<T extends SuggestionAsset = SuggestionAsset> = {
  teamA: string;
  teamB: string;
  /** Leaving `teamA` for `teamB`. */
  a: T[];
  /** Leaving `teamB` for `teamA`. */
  b: T[];
  /** §6's verdict over exactly these two packages — never re-derived. */
  analysis: TradeAnalysis<T>;
  lineupA: LineupChange;
  lineupB: LineupChange;
  score: SuggestionScore;
};

/** Stable identity for a package pair, so the ranking can never be arbitrary. */
function assetKey<T extends SuggestionAsset>(a: T[], b: T[]): string {
  const ids = (assets: T[]) =>
    assets
      .map((asset) => asset.playerId)
      .sort((x, y) => x - y)
      .join(",");
  return `${ids(a)}/${ids(b)}`;
}

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > TIE_EPSILON;
}

/**
 * §9's ranking: "maximizing the *minimum* benefit is what makes it genuinely
 * win-win rather than merely balanced — a trade that helps A enormously and B
 * slightly will lose to one that helps both solidly."
 *
 * Everything after the first key is a tiebreak, and each earns its position:
 *
 * 1. **`minGain`** — the objective §9 names.
 * 2. **`totalGain`** — between two deals that help the worse-off side equally,
 *    the one that creates more is the better deal.
 * 3. **`marketShare`** — §5's rule, applied to a ranking rather than a badge. A
 *    package priced entirely by completed trades is a firmer suggestion than one
 *    resting on the modelled tail, and where the app cannot tell them apart on
 *    merit it should prefer the one it can stand behind.
 * 4. **`pct`** — the more even of two equally good deals is the easier one to
 *    send, because the other manager runs the same arithmetic.
 * 5. **`bodies`** — roster spots are finite (§6). Fewer players for the same
 *    outcome is strictly better.
 * 6. **The asset ids** — nothing left to argue about, and the order must still
 *    be the same on the next sync.
 */
export function compareSuggestions<T extends SuggestionAsset>(
  first: Suggestion<T>,
  second: Suggestion<T>,
): number {
  const a = first.score;
  const b = second.score;

  if (differs(a.minGain, b.minGain)) return b.minGain - a.minGain;
  if (differs(a.totalGain, b.totalGain)) return b.totalGain - a.totalGain;
  if (differs(a.marketShare, b.marketShare)) return b.marketShare - a.marketShare;
  if (differs(a.pct, b.pct)) return a.pct - b.pct;
  if (a.bodies !== b.bodies) return a.bodies - b.bodies;

  return assetKey(first.a, first.b) < assetKey(second.a, second.b) ? -1 : 1;
}

// ---------------------------------------------------------------------------
// the win-win search (Requirement 9)
// ---------------------------------------------------------------------------

export type SearchStats = {
  /** `C(teams, 2)`. */
  pairs: number;
  /** Candidate trades the analyzer was actually run on. */
  evaluated: number;
  /** Candidate trades the value window proved unfair without running it. */
  pruned: number;
  /** Survived §6's fairness band. */
  fair: number;
  /** Survived, and improved *both* starting lineups. */
  winWin: number;
  /** §4: rostered players left out because they carry no resolved value. */
  unvalued: number;
};

export type WinWinResult<T extends SuggestionAsset> = {
  suggestions: Suggestion<T>[];
  stats: SearchStats;
};

type PreparedTeam<T extends SuggestionAsset> = {
  team: SuggestionTeam<T>;
  packages: AssetPackage<T>[];
  /** Solved once. It is a property of the roster, not of the candidate. */
  before: Lineup<T>;
};

/**
 * Requirement 9: every trade in this league that is fair by value *and* leaves
 * both starting lineups better than it found them.
 *
 * Both halves matter. Fair-by-value alone produces a list of trades nobody has
 * a reason to make; better-for-both alone produces a list nobody would accept.
 * The intersection is the only thing worth showing a user, and it is small —
 * which is why the search can afford to be exhaustive inside its bounds rather
 * than clever.
 */
export function searchWinWin<T extends SuggestionAsset>(
  teams: SuggestionTeam<T>[],
  slots: StartingSlot[],
  params: TradeParams = DEFAULT_TRADE_PARAMS,
  limits: { topAssets: number; maxPackage: number; perPair: number } = WIN_WIN_LIMITS,
): WinWinResult<T> {
  const stats: SearchStats = {
    pairs: 0,
    evaluated: 0,
    pruned: 0,
    fair: 0,
    winWin: 0,
    unvalued: 0,
  };

  // Package enumeration and the "before" lineup are per team, not per pair, so
  // they are hoisted out of the O(teams²) loop. In a twelve-team league that is
  // 12 of each rather than 132.
  const prepared: PreparedTeam<T>[] = teams.map((team) => {
    const candidates = candidateAssets(team, limits.topAssets);
    stats.unvalued += candidates.unvalued;

    return {
      team,
      packages: enumeratePackages(candidates.assets, limits.maxPackage),
      before: bestLineup(team.roster, slots),
    };
  });

  const window = baseRatioWindow(params, limits.maxPackage);
  const suggestions: Suggestion<T>[] = [];

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      stats.pairs += 1;
      const found = searchPair(prepared[i], prepared[j], slots, params, window, stats);
      suggestions.push(...diversify(found, limits.perPair));
    }
  }

  return { suggestions: suggestions.sort(compareSuggestions), stats };
}

function searchPair<T extends SuggestionAsset>(
  a: PreparedTeam<T>,
  b: PreparedTeam<T>,
  slots: StartingSlot[],
  params: TradeParams,
  window: { lo: number; hi: number },
  stats: SearchStats,
): Suggestion<T>[] {
  const found: Suggestion<T>[] = [];

  for (const fromA of a.packages) {
    // Only the slice of B's packages whose raw sum could still balance this
    // one. Both ends are binary-searched, so a package pair outside the window
    // is never constructed, let alone scored.
    const start = bound(b.packages, fromA.base * window.lo, false);
    const end = bound(b.packages, fromA.base * window.hi, true);
    stats.pruned += b.packages.length - (end - start);

    for (let index = start; index < end; index += 1) {
      const fromB = b.packages[index];
      stats.evaluated += 1;

      const analysis = analyzeTrade(fromA.assets, fromB.assets, params);
      // No verdict means §4 blocked it. Unvalued players never reach here —
      // `candidateAssets` drops them — but the guard is the type's, not a
      // comment's, and a blocked trade must never become a suggestion.
      if (!analysis.verdict || analysis.verdict.pct >= FAIR_BAND) continue;
      stats.fair += 1;

      const lineupA = lineupChangeFrom(
        a.before,
        a.team.roster,
        { out: fromA.assets, in: fromB.assets },
        slots,
      );
      if (lineupA.delta <= MIN_LINEUP_GAIN) continue;

      const lineupB = lineupChangeFrom(
        b.before,
        b.team.roster,
        { out: fromB.assets, in: fromA.assets },
        slots,
      );
      if (lineupB.delta <= MIN_LINEUP_GAIN) continue;
      stats.winWin += 1;

      found.push({
        teamA: a.team.teamId,
        teamB: b.team.teamId,
        a: fromA.assets,
        b: fromB.assets,
        analysis,
        lineupA,
        lineupB,
        score: {
          minGain: Math.min(lineupA.delta, lineupB.delta),
          totalGain: lineupA.delta + lineupB.delta,
          marketShare: analysis.marketShare,
          pct: analysis.verdict.pct,
          bodies: fromA.assets.length + fromB.assets.length,
        },
      });
    }
  }

  return found;
}

/**
 * Keeps the best `limit` suggestions that are actually different deals.
 *
 * Ranked purely, the top of a pair's list is the same trade three times: a
 * headliner swap, then the same swap with a throw-in, then the same swap with a
 * different throw-in. §10 asks for a carousel the user *cycles* through, which
 * is only worth building if the cards disagree with each other, so at most one
 * suggestion per pair of headliners survives. The cost is real and worth
 * stating: a genuinely better 2-for-2 sharing its headliners with the winner is
 * dropped, and the user sees the simpler deal instead.
 */
function diversify<T extends SuggestionAsset>(
  found: Suggestion<T>[],
  limit: number,
): Suggestion<T>[] {
  const kept: Suggestion<T>[] = [];
  const seen = new Set<string>();

  for (const suggestion of [...found].sort(compareSuggestions)) {
    if (kept.length >= limit) break;

    const key = `${suggestion.analysis.a.best?.playerId ?? 0}:${
      suggestion.analysis.b.best?.playerId ?? 0
    }`;
    if (seen.has(key)) continue;

    seen.add(key);
    kept.push(suggestion);
  }

  return kept;
}

// ---------------------------------------------------------------------------
// the player-based builder (Requirement 10)
// ---------------------------------------------------------------------------

export type BuilderBlock = "unvalued" | "no-pieces";

export type BuilderStats = {
  /** What the target alone totals to on §6's math — the price to be met. */
  askingPrice: number;
  /** Subsets of the user's roster the analyzer was run on. */
  evaluated: number;
  /** Landed inside the fairness band. */
  fair: number;
  /** §4: the user's own players with no resolved value, left out. */
  unvalued: number;
  /** Pieces held back because §7 says the user is thin at that position. */
  protectedPieces: number;
  /**
   * True when protecting them would have left nothing to offer, so the
   * exclusion was dropped. An exclusion that empties the roster is not a
   * filter, it is a refusal to answer.
   */
  relaxed: boolean;
  /** Set when there is nothing to search and why. */
  blocked: BuilderBlock | null;
};

export type BuilderResult<T extends SuggestionAsset> = {
  suggestions: Suggestion<T>[];
  stats: BuilderStats;
};

/**
 * Requirement 10: "given a target player `T` on team `B`, … return 3–5
 * alternative packages rather than one answer."
 *
 * The menu is the feature. A single answer to "what would it take to get
 * Jefferson" is a number pretending to be a negotiation; three packages at the
 * same price, made of different players, is something a manager can actually
 * open a conversation with.
 *
 * Ranked on the user's own lineup delta, as §10 asks — and *not* filtered on
 * it. A package that leaves the user's starters slightly thinner is still the
 * price of the player they asked about, and refusing to show it would be
 * answering a different question than the one that was put.
 */
export function buildPackages<T extends SuggestionAsset>(
  {
    target,
    from,
    to,
  }: {
    /** The player being acquired. Must be on `from`. */
    target: T;
    /** The team that holds them. */
    from: SuggestionTeam<T>;
    /** The user's team, who is paying. */
    to: SuggestionTeam<T>;
  },
  slots: StartingSlot[],
  params: TradeParams = DEFAULT_TRADE_PARAMS,
  limits: { maxPackage: number; results: number; topAssets: number } = BUILDER_LIMITS,
): BuilderResult<T> {
  // §10's "T's value plus the bonus math from Section 6" — the half of that
  // math which belongs to one side. The headline premium is a *cross-side*
  // term and has no value until there is another package to compare against,
  // which is precisely what this search is about to go and produce.
  const asking = target.value * (1 + Math.max(0, params.alpha));

  const stats: BuilderStats = {
    askingPrice: asking,
    evaluated: 0,
    fair: 0,
    unvalued: 0,
    protectedPieces: 0,
    relaxed: false,
    blocked: null,
  };

  // §4, and it is the whole rule in one line: a player with no resolved value
  // cannot be priced, so there is no package to build around them. The
  // analyzer would refuse this trade a verdict and the builder refuses it a
  // search, for the same reason.
  if (target.source === "floor") {
    return { suggestions: [], stats: { ...stats, blocked: "unvalued" } };
  }

  const thin = (asset: T) => {
    const position = normalizePosition(asset.position);
    return position !== null && (to.need[position] ?? 0) > NEED_EXCLUSION_Z;
  };

  let candidates = candidateAssets(to, limits.topAssets, { exclude: thin });
  stats.unvalued = candidates.unvalued;
  stats.protectedPieces = to.roster.filter(
    (asset) => asset.source !== "floor" && isTradeAsset(asset.position) && thin(asset),
  ).length;

  if (candidates.assets.length === 0 && stats.protectedPieces > 0) {
    candidates = candidateAssets(to, limits.topAssets);
    stats.relaxed = true;
  }

  if (candidates.assets.length === 0) {
    return { suggestions: [], stats: { ...stats, blocked: "no-pieces" } };
  }

  const beforeTo = bestLineup(to.roster, slots);
  const beforeFrom = bestLineup(from.roster, slots);
  const window = baseRatioWindow(params, limits.maxPackage);
  const incoming = [target];

  const found: Suggestion<T>[] = [];

  for (const offer of enumeratePackages(candidates.assets, limits.maxPackage)) {
    // The same exact bound the win-win search uses, applied against one fixed
    // package instead of a sorted list of them.
    if (offer.base < target.value * window.lo) continue;
    if (offer.base > target.value * window.hi) continue;
    stats.evaluated += 1;

    const analysis = analyzeTrade(offer.assets, incoming, params);
    if (!analysis.verdict || analysis.verdict.pct >= FAIR_BAND) continue;
    stats.fair += 1;

    const lineupA = lineupChangeFrom(
      beforeTo,
      to.roster,
      { out: offer.assets, in: incoming },
      slots,
    );
    const lineupB = lineupChangeFrom(
      beforeFrom,
      from.roster,
      { out: incoming, in: offer.assets },
      slots,
    );

    found.push({
      teamA: to.teamId,
      teamB: from.teamId,
      a: offer.assets,
      b: incoming,
      analysis,
      lineupA,
      lineupB,
      score: {
        minGain: Math.min(lineupA.delta, lineupB.delta),
        totalGain: lineupA.delta + lineupB.delta,
        marketShare: analysis.marketShare,
        pct: analysis.verdict.pct,
        bodies: offer.assets.length + 1,
      },
    });
  }

  return { suggestions: pickMenu(found, limits.results), stats };
}

/**
 * §10's ranking — the user's own lineup delta — with the two rules that turn a
 * ranked list into a menu.
 *
 * Superset suppression is the important one: a package that is another package
 * plus a throw-in is not an alternative to it, it is the same offer with a
 * sweetener, and showing both spends two of five slots on one idea. The kept
 * package is always the better-ranked of the two, so the throw-in is being
 * dropped only where it did not help.
 */
function pickMenu<T extends SuggestionAsset>(
  found: Suggestion<T>[],
  limit: number,
): Suggestion<T>[] {
  const ranked = [...found].sort((first, second) => {
    if (differs(first.lineupA.delta, second.lineupA.delta)) {
      return second.lineupA.delta - first.lineupA.delta;
    }
    // §10 names one key. The rest are `compareSuggestions`', so a builder
    // package and a win-win package are never ordered by different rules.
    return compareSuggestions(first, second);
  });

  const kept: Suggestion<T>[] = [];
  const keptSets: Set<number>[] = [];

  for (const suggestion of ranked) {
    if (kept.length >= limit) break;

    const ids = new Set(suggestion.a.map((asset) => asset.playerId));
    const redundant = keptSets.some((previous) => {
      if (previous.size >= ids.size) return false;
      for (const id of previous) if (!ids.has(id)) return false;
      return true;
    });
    if (redundant) continue;

    keptSets.push(ids);
    kept.push(suggestion);
  }

  return kept;
}

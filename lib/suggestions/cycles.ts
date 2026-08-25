/**
 * Requirement 11: three-team trades, as a bounded beam search over cycles (§7).
 *
 * A three-team trade is not a bigger two-team trade, it is a **cycle**: A gives
 * to B, B gives to C, C gives to A. Nobody trades with anybody directly, which
 * is exactly why the deal exists — it is the trade you make when A wants what C
 * has, C wants what B has, and B wants what A has, and no two of them can pair
 * off. That structure is also what makes the space explode, because a candidate
 * is now an ordered triple of packages rather than a pair.
 *
 * Nothing here is new arithmetic, for the reason `search.ts` has none: every
 * participant is scored by `analyzeTrade` (§6) on their own in-vs-out and by
 * `lineupChangeFrom` (§6's roster-context delta) on their own starting lineup.
 * **Each ledger stands alone.** A cycle whose three legs happen to balance
 * overall while one manager is being robbed is not a fair trade with a rounding
 * error in it; it is a robbery, and the per-leg verdict is what says so. There
 * is no cycle-level fairness number anywhere in this file.
 *
 * No `server-only` and no transport, like every other math module in this app,
 * so a test and a sync stage run the identical function over identical data.
 *
 * ---------------------------------------------------------------------------
 * The search space, stated plainly
 * ---------------------------------------------------------------------------
 *
 * §7 sets three bounds — "restrict to the top 6 assets per team and ≤ 2 assets
 * per leg, beam search width 50" — and here is what they are bounding.
 *
 * ```
 * per team            C(6,1) + C(6,2)              =        21 packages
 * per directed cycle  21³                          =     9,261 candidates
 * directed 3-cycles   C(12,3) × 2                  =       440
 * whole league        440 × 9,261                  = 4,074,840 candidates
 * ```
 *
 * That is 48× Phase 8's two-team space of 85,536 — and each candidate costs
 * *three* analyzer runs and three lineup solves instead of two. Phase 8 scored
 * 11,341 survivors in ~33 ms; the same machinery over the whole three-team
 * space would be minutes, inside a sync stage §9 caps at ~60 seconds. So it is
 * cut four ways, and they are not interchangeable — three of them discard
 * nothing they were not entitled to, and one of them is a guess:
 *
 * 1. **Six assets a team, not §9's eight.** §7's own number, and the cube above
 *    is why: eight would take a directed cycle from 9,261 candidates to 46,656,
 *    five times the bill for a roster's eighth and ninth-best players — who are
 *    throw-ins rather than the reason anyone picks up the phone about a
 *    three-way.
 * 2. **Anchored.** One search asks "which cycles could *this* team be in",
 *    which is `11 × 10 = 110` orientations rather than 440. Both directions
 *    round the ring are covered, because A → B → C → A and A → C → B → A move
 *    different players and are different trades. Stage 8 then runs one search
 *    per team; the redundancy that implies — every cycle reachable from three
 *    anchors — is paid for and measured, and it is what makes each individual
 *    search small enough to bound.
 * 3. **An exact value window, twice.** `windowSlice`, unchanged from §9: a pair
 *    of packages outside a multiplicative window on their raw sums cannot reach
 *    the fairness band whatever §6's bonuses do to them, so it is never
 *    constructed. The closing leg is bounded by *two* such windows at once —
 *    the partner behind it and the anchor in front of it — and because the
 *    window is symmetric they collapse into one slice of one sorted list.
 * 4. **Beam.** The cycle is built in two steps and the middle of it is cut down
 *    to `beamWidth` partial cycles before the third team is ever considered.
 *
 * The first three are prunes or bounds. The fourth is not, and the next section
 * is about exactly what it costs.
 *
 * ---------------------------------------------------------------------------
 * What the beam gives up
 * ---------------------------------------------------------------------------
 *
 * The search runs at two depths:
 *
 * - **Opening.** Pick the anchor's package `Pa` and a partner `B` with a
 *   package `Pb`. That already completes *B's* ledger — B sends `Pb` and
 *   receives `Pa`, whatever happens next — so B is fully scored here: §6's
 *   verdict on `(Pb, Pa)` must be inside the fairness band, and B's starting
 *   lineup must improve. Both filters are **exact**; nothing survives them that
 *   the finished cycle would have rejected.
 * - **Closing.** Pick the third team `C` and its package `Pc`. That completes
 *   both remaining ledgers at once — C sends `Pc` and receives `Pb`, A sends
 *   `Pa` and receives `Pc` — and both are scored the same way.
 *
 * Between the two, the openings are sorted and cut to `beamWidth`. What they
 * are sorted on took two attempts and the first one is worth recording, because
 * it looked right on paper.
 *
 * The objective is `min(Δa, Δb, Δc)`, and at the opening ΔB is the only one of
 * the three that exists — it is also an *upper bound* on the finished cycle's
 * score, since a minimum cannot exceed one of its terms. Ranking on it
 * therefore keeps the openings with the highest ceilings. That is true and it
 * is the wrong key, because the bound is **biased**: the way to maximize ΔB is
 * to pay the middle team out of the anchor's own starting lineup, and the
 * anchor is the team that asked. On the test league in `cycles.test.ts` a pure
 * ΔB beam fills itself with openings that hand over a starter for ten points of
 * extra generosity toward somebody else, and returns a cycle worth 140 to the
 * anchor when one worth 150 was sitting right behind the cut.
 *
 * So the key is `ΔB − strip(Pa)`: pay the middle team as much as possible, out
 * of the players the anchor can most afford to lose. `strip` is what sending
 * `Pa` costs the anchor's own lineup with nothing yet coming back — known
 * exactly at this depth, unlike what the anchor eventually receives. That is an
 * estimate rather than a bound, and the claim for it is only that it is the
 * best-informed one available where two thirds of the deal does not exist yet.
 *
 * Either way, **the beam can miss trades that exist**, and this is where the
 * honesty is owed. It is not a prune — `windowSlice` is a prune, and it is
 * exact — it is a heuristic truncation. An opening just under the cut may close
 * into the best cycle in the league and never be looked at. The stats count
 * what was dropped so the UI can say so rather than implying the list is
 * complete.
 *
 * One more cut on top of it, for a reason that is about people rather than
 * search: a plain top-50 collapses onto a single partner, because if manager B
 * is a good fit for the anchor then the fifty best openings are fifty
 * variations on trading with manager B. `beamPerPartner` caps how much of the
 * beam any one partner can occupy, so the closings are spread across the
 * league. The cost is stated rather than hidden — it is a *worse* beam by the
 * objective, deliberately, because eleven mediocre partners beat one good one
 * when only one of the eleven has to say yes.
 *
 * ---------------------------------------------------------------------------
 * Where it runs, and how that was decided
 * ---------------------------------------------------------------------------
 *
 * In sync stage 8, once per team, cached — and that was settled by measuring
 * rather than by argument, because §7's warning about the combinatorics is a
 * warning about exactly this decision.
 *
 * What makes it affordable is that the cost is a function of the bounds and not
 * of the league's data: per anchor the search scores at most `(n−1) × 21 × 21`
 * openings and `beamWidth × (n−2) × 21` closings, whatever the rosters contain.
 * Measured on a synthetic twelve-team league that is ~8 ms an anchor and ~93 ms
 * for all twelve, against the ~35 ms §9's win-win search spends over the same
 * league — together under 0.25% of a stage §9 caps at ~60s. Had the number gone
 * the other way, the honest answer would have been to run this on demand for
 * one team rather than to spend the sync budget; it did not, so the whole
 * league is searched, which buys the same thing §9's board buys by covering
 * every pair. Knowing that two *other* managers have an obvious three-way
 * sitting between them is a reason to get there first.
 *
 * The README carries the full table, including what widening the beam costs
 * and finds.
 */
import {
  bestLineup,
  lineupChangeFrom,
  type LineupChange,
} from "@/lib/needs/lineup";
import {
  analyzeTrade,
  DEFAULT_TRADE_PARAMS,
  type TradeAnalysis,
  type TradeParams,
} from "@/lib/trades/analyze";
import type { StartingSlot } from "@/lib/values/vor";

import {
  baseRatioWindow,
  compareScores,
  FAIR_BAND,
  MIN_LINEUP_GAIN,
  prepareTeam,
  windowSlice,
  type AssetPackage,
  type PreparedTeam,
  type SuggestionAsset,
  type SuggestionScore,
  type SuggestionTeam,
} from "./search";

// ---------------------------------------------------------------------------
// the bounds
// ---------------------------------------------------------------------------

export type CycleLimits = {
  /** §7: "restrict to the top 6 assets per team". */
  topAssets: number;
  /** §7: "≤ 2 assets per leg". */
  maxPackage: number;
  /** §7: "beam search width 50". */
  beamWidth: number;
  /** How much of the beam one partner may occupy. */
  beamPerPartner: number;
  /** How many finished cycles come back. */
  results: number;
};

/**
 * §7's own numbers, plus the two it does not name.
 *
 * **Six assets, not §9's eight.** The plan drops the candidate list by two for
 * the three-team case and the arithmetic says why: packages go as the square of
 * the asset count and candidates as the *cube* of the package count, so eight
 * would take a directed cycle from 9,261 candidates to 46,656 — five times the
 * bill for the eighth and ninth-best players on a roster, who are throw-ins
 * rather than the reason anyone picks up the phone about a three-way.
 *
 * **`beamPerPartner` is 6** — enough that eleven partners could fill 66 slots
 * of a 50-wide beam, so the cap binds only where one partner is running away
 * with it, which is exactly when it should.
 *
 * **`results` is 5**, matching §10's builder rather than §9's per-pair three. A
 * three-team trade needs two other managers to agree, so a menu is worth more
 * here than it is anywhere else in the app.
 */
export const CYCLE_LIMITS: CycleLimits = {
  topAssets: 6,
  maxPackage: 2,
  beamWidth: 50,
  beamPerPartner: 6,
  results: 5,
};

/** How many teams a cycle needs. Three is the feature, not a parameter. */
export const CYCLE_TEAMS = 3;

// ---------------------------------------------------------------------------
// what a cycle is
// ---------------------------------------------------------------------------

/**
 * One participant's whole position in the deal: what they send, who they send
 * it to, what §6 makes of their own ledger, and what it does to their lineup.
 *
 * `analysis.a` is always this team's outgoing package and `analysis.b` always
 * what they receive, so a leg is readable on its own — which is the point, and
 * the property the whole phase turns on.
 */
export type CycleLeg<T extends SuggestionAsset = SuggestionAsset> = {
  teamId: string;
  /** Where this leg's players land. The team they *receive* from is the previous leg. */
  toTeamId: string;
  assets: T[];
  /** §6's verdict over this team alone: `analyzeTrade(sent, received)`. */
  analysis: TradeAnalysis<T>;
  lineup: LineupChange;
};

export type CycleSuggestion<T extends SuggestionAsset = SuggestionAsset> = {
  /** The team the search was run for. Always `legs[0]`. */
  anchorTeamId: string;
  /** In ring order: `legs[i]` sends to `legs[i + 1]`, and `legs[2]` sends to `legs[0]`. */
  legs: [CycleLeg<T>, CycleLeg<T>, CycleLeg<T>];
  /**
   * The same five keys §9's suggestions carry, folded over three participants
   * instead of two — `pct` is the **worst** leg's, because a cycle is exactly
   * as fair as the manager who is doing worst out of it.
   */
  score: SuggestionScore;
};

export type CycleBlock = "no-anchor" | "too-few-teams" | "no-pieces";

export type CycleStats = {
  /** Ordered (partner, third) placements around the anchor: `(n−1)(n−2)`. */
  orientations: number;
  /**
   * Candidates an exhaustive search of those orientations would have scored —
   * `Σ |Pa| × |Pb| × |Pc|` over every one of them, counted exactly rather than
   * estimated. This is the number the bounds exist to avoid.
   */
  space: number;
  /** Openings the value window could not rule out, so the analyzer scored them. */
  openings: number;
  /** Openings the window proved unfair without running the analyzer. */
  openingsPruned: number;
  /** Openings that were fair for the middle team *and* improved its lineup. */
  viable: number;
  /** How many of those survived the beam. */
  beam: number;
  /** How many the beam dropped — what this search knowingly did not look at. */
  dropped: number;
  /** Closing candidates scored. */
  closings: number;
  /** Closing candidates the two-sided window ruled out first. */
  closingsPruned: number;
  /** Complete cycles: fair for all three, and better for all three lineups. */
  cycles: number;
  /** §4: rostered players left out of every package for want of a resolved value. */
  unvalued: number;
  /** Set when there was nothing to search, and why. */
  blocked: CycleBlock | null;
};

export type CycleResult<T extends SuggestionAsset = SuggestionAsset> = {
  cycles: CycleSuggestion<T>[];
  stats: CycleStats;
};

function emptyStats(blocked: CycleBlock | null = null): CycleStats {
  return {
    orientations: 0,
    space: 0,
    openings: 0,
    openingsPruned: 0,
    viable: 0,
    beam: 0,
    dropped: 0,
    closings: 0,
    closingsPruned: 0,
    cycles: 0,
    unvalued: 0,
    blocked,
  };
}

// ---------------------------------------------------------------------------
// the search
// ---------------------------------------------------------------------------

/** A cycle with its third team still missing, and the middle team already scored. */
type Opening<T extends SuggestionAsset> = {
  fromAnchor: AssetPackage<T>;
  partner: PreparedTeam<T>;
  fromPartner: AssetPackage<T>;
  analysis: TradeAnalysis<T>;
  lineup: LineupChange;
  /** What sending `fromAnchor` costs the anchor's lineup, before anything returns. */
  strip: number;
  /** Player ids, so the beam's cut is the same on two runs over one league. */
  key: string;
};

function idsOf<T extends SuggestionAsset>(assets: T[]): string {
  return assets
    .map((asset) => asset.playerId)
    .sort((a, b) => a - b)
    .join(",");
}

/**
 * Requirement 11: the three-team cycles one team could be in that are fair for
 * every participant on their own ledger and leave all three starting lineups
 * better than they found them.
 *
 * The anchor is required rather than optional, and it is not a filter applied
 * afterwards: it is what makes one search 110 orientations instead of 440 and
 * therefore what makes the whole thing boundable. Covering the league is twelve
 * calls, which is how sync stage 8 uses it.
 */
export function searchCycles<T extends SuggestionAsset>(
  {
    anchorTeamId,
    teams,
  }: {
    anchorTeamId: string;
    teams: SuggestionTeam<T>[];
  },
  slots: StartingSlot[],
  params: TradeParams = DEFAULT_TRADE_PARAMS,
  limits: CycleLimits = CYCLE_LIMITS,
): CycleResult<T> {
  const anchorTeam = teams.find((team) => team.teamId === anchorTeamId);
  if (!anchorTeam) return { cycles: [], stats: emptyStats("no-anchor") };

  const prepared = teams.map((team) => prepareTeam(team, slots, limits));
  const unvalued = prepared.reduce(
    (sum, ready) => sum + ready.candidates.unvalued,
    0,
  );

  const anchor = prepared.find((ready) => ready.team.teamId === anchorTeamId)!;
  const others = prepared.filter((ready) => ready.team.teamId !== anchorTeamId);
  const stocked = prepared.filter((ready) => ready.packages.length > 0);

  // A cycle needs three teams that can each put a package on the table, and
  // "there are not three" is a different answer from "there is no cycle". A
  // league whose sync never reached Yahoo has twelve empty rosters; a league
  // where a third team holds nothing but kickers and unresolved players has
  // twelve real ones and still no ring to close. Both read very differently to
  // someone deciding whether to trust an empty list, so both are named.
  if (stocked.length < CYCLE_TEAMS) {
    return {
      cycles: [],
      stats: {
        ...emptyStats(teams.length < CYCLE_TEAMS ? "too-few-teams" : "no-pieces"),
        unvalued,
      },
    };
  }
  if (anchor.packages.length === 0) {
    return { cycles: [], stats: { ...emptyStats("no-pieces"), unvalued } };
  }

  const stats = emptyStats();
  stats.unvalued = unvalued;

  for (const partner of others) {
    for (const third of others) {
      if (third.team.teamId === partner.team.teamId) continue;
      stats.orientations += 1;
      stats.space +=
        anchor.packages.length * partner.packages.length * third.packages.length;
    }
  }

  const window = baseRatioWindow(params, limits.maxPackage);
  const openings = openCycles(anchor, others, slots, params, window, stats);

  stats.viable = openings.length;
  const beam = cutBeam(openings, limits);
  stats.beam = beam.length;
  stats.dropped = openings.length - beam.length;

  const cycles = closeCycles(anchor, others, beam, slots, params, window, stats);
  stats.cycles = cycles.length;

  return { cycles: pickCycles(cycles, limits.results), stats };
}

/**
 * Depth one: every (anchor package, partner, partner package) whose *middle*
 * team is already getting a deal it would take.
 *
 * Both tests here are the finished cycle's own. B's ledger never changes again
 * — they send `Pb` and receive `Pa` no matter who the third team turns out to
 * be — so a partial rejected here could not have survived, and the filter costs
 * the search nothing in completeness. That is the difference between this step
 * and the beam that follows it.
 */
function openCycles<T extends SuggestionAsset>(
  anchor: PreparedTeam<T>,
  others: PreparedTeam<T>[],
  slots: StartingSlot[],
  params: TradeParams,
  window: { lo: number; hi: number },
  stats: CycleStats,
): Opening<T>[] {
  const found: Opening<T>[] = [];

  for (const fromAnchor of anchor.packages) {
    // Solved once per anchor package rather than once per opening: what this
    // package costs the anchor's lineup is a property of the package, and the
    // beam's sort key needs it for every partner it is paired with.
    const leaving = new Set(fromAnchor.assets.map((entry) => entry.playerId));
    const strip =
      anchor.before.points -
      bestLineup(
        anchor.team.roster.filter((player) => !leaving.has(player.playerId)),
        slots,
      ).points;

    for (const partner of others) {
      const { start, end } = windowSlice(
        partner.packages,
        fromAnchor.base * window.lo,
        fromAnchor.base * window.hi,
      );
      stats.openingsPruned += partner.packages.length - (end - start);

      for (let index = start; index < end; index += 1) {
        const fromPartner = partner.packages[index];
        stats.openings += 1;

        const analysis = analyzeTrade(fromPartner.assets, fromAnchor.assets, params);
        // §4: no verdict means the trade is blocked, and a blocked trade must
        // never become a suggestion. Unvalued players never reach here —
        // `candidateAssets` drops them — but the guard belongs to the type.
        if (!analysis.verdict || analysis.verdict.pct >= FAIR_BAND) continue;

        const lineup = lineupChangeFrom(
          partner.before,
          partner.team.roster,
          { out: fromPartner.assets, in: fromAnchor.assets },
          slots,
        );
        if (lineup.delta <= MIN_LINEUP_GAIN) continue;

        found.push({
          fromAnchor,
          partner,
          fromPartner,
          analysis,
          lineup,
          strip,
          key: `${idsOf(fromAnchor.assets)}>${partner.team.teamId}>${idsOf(fromPartner.assets)}`,
        });
      }
    }
  }

  return found;
}

/**
 * §7's beam, width 50, with the per-partner cap the plan does not mention and
 * the search needs anyway.
 *
 * Sorted on `ΔB − strip` — how much the opening pays the middle team, net of
 * what it costs the team that asked — for the reason the header sets out at
 * length: the middle team's gain alone is a real upper bound on the objective
 * and a badly biased one, maximized by openings that spend the anchor's own
 * starting lineup on somebody else's.
 *
 * It is still a cut, and `stats.dropped` counts what it threw away.
 */
function cutBeam<T extends SuggestionAsset>(
  openings: Opening<T>[],
  limits: CycleLimits,
): Opening<T>[] {
  const ranked = [...openings].sort((first, second) => {
    const net =
      second.lineup.delta - second.strip - (first.lineup.delta - first.strip);
    if (Math.abs(net) > 1e-6) return net;

    // Between two openings that come out level on the estimate, prefer the one
    // that costs the anchor less outright. Its cost is the only part of the
    // anchor's ledger that is known here, and the anchor is the team that has
    // to want this trade.
    const cost = first.strip - second.strip;
    if (Math.abs(cost) > 1e-6) return cost;

    // Then the more even ask, and then the id — so the beam's membership never
    // depends on the order the loops happened to generate it in.
    const pct = first.analysis.verdict!.pct - second.analysis.verdict!.pct;
    if (Math.abs(pct) > 1e-6) return pct;
    return first.key < second.key ? -1 : 1;
  });

  const kept: Opening<T>[] = [];
  const perPartner = new Map<string, number>();

  for (const opening of ranked) {
    if (kept.length >= limits.beamWidth) break;

    const taken = perPartner.get(opening.partner.team.teamId) ?? 0;
    if (taken >= limits.beamPerPartner) continue;

    perPartner.set(opening.partner.team.teamId, taken + 1);
    kept.push(opening);
  }

  return kept;
}

/**
 * Depth two: close the ring.
 *
 * The third package has to balance two teams at once — the partner behind it
 * and the anchor in front of it — so it is bounded by the *intersection* of two
 * value windows before either analyzer run happens. The windows are symmetric
 * (`hi = 1/lo`), which is what lets the two constraints collapse into one slice
 * of one sorted list.
 *
 * Then both remaining ledgers are scored in full, independently, and a cycle
 * survives only if it is fair for both and better for both lineups. §7's
 * requirement — "each team must independently land inside the fairness band on
 * its own in-vs-out" — is these two `analyzeTrade` calls plus the one the
 * opening already made, and nothing else.
 */
function closeCycles<T extends SuggestionAsset>(
  anchor: PreparedTeam<T>,
  others: PreparedTeam<T>[],
  beam: Opening<T>[],
  slots: StartingSlot[],
  params: TradeParams,
  window: { lo: number; hi: number },
  stats: CycleStats,
): CycleSuggestion<T>[] {
  const found: CycleSuggestion<T>[] = [];

  for (const opening of beam) {
    const { fromAnchor, partner, fromPartner } = opening;

    for (const third of others) {
      if (third.team.teamId === partner.team.teamId) continue;

      const { start, end } = windowSlice(
        third.packages,
        Math.max(fromPartner.base * window.lo, fromAnchor.base * window.lo),
        Math.min(fromPartner.base * window.hi, fromAnchor.base * window.hi),
      );
      stats.closingsPruned += third.packages.length - (end - start);

      for (let index = start; index < end; index += 1) {
        const fromThird = third.packages[index];
        stats.closings += 1;

        // C's own ledger: sends `Pc`, receives `Pb` from the partner.
        const thirdAnalysis = analyzeTrade(
          fromThird.assets,
          fromPartner.assets,
          params,
        );
        if (!thirdAnalysis.verdict || thirdAnalysis.verdict.pct >= FAIR_BAND) {
          continue;
        }

        // The anchor's own ledger: sends `Pa`, receives `Pc`. Scored last
        // because it is the one the beam never had an opinion about.
        const anchorAnalysis = analyzeTrade(
          fromAnchor.assets,
          fromThird.assets,
          params,
        );
        if (!anchorAnalysis.verdict || anchorAnalysis.verdict.pct >= FAIR_BAND) {
          continue;
        }

        const thirdLineup = lineupChangeFrom(
          third.before,
          third.team.roster,
          { out: fromThird.assets, in: fromPartner.assets },
          slots,
        );
        if (thirdLineup.delta <= MIN_LINEUP_GAIN) continue;

        const anchorLineup = lineupChangeFrom(
          anchor.before,
          anchor.team.roster,
          { out: fromAnchor.assets, in: fromThird.assets },
          slots,
        );
        if (anchorLineup.delta <= MIN_LINEUP_GAIN) continue;

        found.push(
          assemble(
            anchor.team.teamId,
            [
              {
                teamId: anchor.team.teamId,
                toTeamId: partner.team.teamId,
                assets: fromAnchor.assets,
                analysis: anchorAnalysis,
                lineup: anchorLineup,
              },
              {
                teamId: partner.team.teamId,
                toTeamId: third.team.teamId,
                assets: fromPartner.assets,
                analysis: opening.analysis,
                lineup: opening.lineup,
              },
              {
                teamId: third.team.teamId,
                toTeamId: anchor.team.teamId,
                assets: fromThird.assets,
                analysis: thirdAnalysis,
                lineup: thirdLineup,
              },
            ],
          ),
        );
      }
    }
  }

  return found;
}

/**
 * The five ranking keys, folded over three participants.
 *
 * `pct` is the **maximum** of the three rather than an average, because §7's
 * requirement is about the worst-treated manager: a cycle is exactly as sendable
 * as its most lopsided leg, and averaging would let a robbery hide behind two
 * even legs. Everything else folds the obvious way — the minimum gain over
 * three, the total over three, and one market share over every asset on the
 * table rather than three overlapping ones (each package is in two legs'
 * analyses, so summing those would count it twice).
 */
function assemble<T extends SuggestionAsset>(
  anchorTeamId: string,
  legs: [CycleLeg<T>, CycleLeg<T>, CycleLeg<T>],
): CycleSuggestion<T> {
  const moving = legs.flatMap((leg) => leg.assets);
  const base = moving.reduce((sum, asset) => sum + asset.value, 0);
  const market = moving
    .filter((asset) => asset.source === "market")
    .reduce((sum, asset) => sum + asset.value, 0);

  const deltas = legs.map((leg) => leg.lineup.delta);

  return {
    anchorTeamId,
    legs,
    score: {
      minGain: Math.min(...deltas),
      totalGain: deltas.reduce((sum, delta) => sum + delta, 0),
      marketShare: base === 0 ? 1 : market / base,
      pct: Math.max(...legs.map((leg) => leg.analysis.verdict!.pct)),
      bodies: moving.length,
    },
  };
}

/** The leg whose verdict the cycle is reported at: the least even of the three. */
export function worstLeg<T extends SuggestionAsset>(
  cycle: CycleSuggestion<T>,
): CycleLeg<T> {
  return cycle.legs.reduce((worst, leg) =>
    leg.analysis.verdict!.pct > worst.analysis.verdict!.pct ? leg : worst,
  );
}

/**
 * Ranks the finished cycles and keeps a menu of genuinely different ones.
 *
 * Same shape as §9's `diversify` and the same argument: ranked purely, the top
 * of the list is one deal three times over with the throw-ins shuffled, and a
 * menu is only worth showing if the entries disagree. The key here is the three
 * headliners *and* the direction round the ring, because the same three
 * managers trading the same three stars the other way is a different offer to
 * every one of them.
 */
function pickCycles<T extends SuggestionAsset>(
  found: CycleSuggestion<T>[],
  limit: number,
): CycleSuggestion<T>[] {
  const ranked = [...found].sort((first, second) => {
    const ordered = compareScores(first.score, second.score);
    if (ordered !== 0) return ordered;
    return cycleKey(first) < cycleKey(second) ? -1 : 1;
  });

  const kept: CycleSuggestion<T>[] = [];
  const seen = new Set<string>();

  for (const cycle of ranked) {
    if (kept.length >= limit) break;

    const key = cycle.legs
      .map((leg) => `${leg.teamId}:${leg.analysis.a.best?.playerId ?? 0}`)
      .join(">");
    if (seen.has(key)) continue;

    seen.add(key);
    kept.push(cycle);
  }

  return kept;
}

/** Stable identity for a whole cycle, so two equal scores never shuffle. */
function cycleKey<T extends SuggestionAsset>(cycle: CycleSuggestion<T>): string {
  return cycle.legs.map((leg) => `${leg.teamId}:${idsOf(leg.assets)}`).join(">");
}

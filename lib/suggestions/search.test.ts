import { describe, expect, it } from "vitest";

import { bestLineup } from "@/lib/needs/lineup";
import {
  analyzeTrade,
  DEFAULT_TRADE_PARAMS,
  type TradeParams,
} from "@/lib/trades/analyze";
import type { ValueSource } from "@/lib/values/engine";
import type { StartingSlot } from "@/lib/values/vor";

import {
  baseRatioWindow,
  buildPackages,
  BUILDER_LIMITS,
  candidateAssets,
  compareSuggestions,
  enumeratePackages,
  FAIR_BAND,
  MIN_LINEUP_GAIN,
  searchWinWin,
  tradeability,
  WIN_WIN_LIMITS,
  type Suggestion,
  type SuggestionAsset,
  type SuggestionTeam,
} from "./search";

/**
 * Values on FantasyCalc's real scale, for the reason `analyze.test.ts` uses it:
 * the fairness band is a ratio, and a toy scale hides what a steeply convex
 * value curve does to a two-for-one.
 */
function asset(
  playerId: number,
  {
    teamId = "A",
    position = "RB",
    value = 3000,
    points = 100,
    source = "market",
  }: Partial<Omit<SuggestionAsset, "playerId">> & { source?: ValueSource } = {},
): SuggestionAsset {
  return { playerId, teamId, position, value, points, source };
}

function team(
  teamId: string,
  roster: SuggestionAsset[],
  {
    surplusZ = {},
    need = {},
  }: { surplusZ?: Record<string, number>; need?: Record<string, number> } = {},
): SuggestionTeam {
  return {
    teamId,
    roster: roster.map((player) => ({ ...player, teamId })),
    surplusZ,
    need,
  };
}

const slot = (position: string, count: number): StartingSlot => ({
  position,
  count,
  isStarting: true,
});

/** One RB, one WR, one flex either can fill — enough for a lineup to have an opinion. */
const SLOTS: StartingSlot[] = [slot("RB", 1), slot("WR", 1), slot("W/R/T", 1)];

/**
 * The mirrored league: A is three deep at running back and empty at receiver,
 * B is the same picture reflected. Swapping the second-best of each is worth
 * ~120 projected points to both of them and costs neither side any value.
 */
function mirroredLeague(value = 3000) {
  const a = team(
    "A",
    [
      asset(1, { position: "RB", points: 200, value }),
      asset(2, { position: "RB", points: 190, value }),
      asset(3, { position: "RB", points: 180, value }),
      asset(4, { position: "WR", points: 60, value }),
    ],
    { surplusZ: { RB: 1.5, WR: -1.2 }, need: { RB: -1.5, WR: 1.2 } },
  );

  const b = team(
    "B",
    [
      asset(11, { position: "WR", points: 200, value }),
      asset(12, { position: "WR", points: 190, value }),
      asset(13, { position: "WR", points: 180, value }),
      asset(14, { position: "RB", points: 60, value }),
    ],
    { surplusZ: { WR: 1.5, RB: -1.2 }, need: { WR: -1.5, RB: 1.2 } },
  );

  return [a, b];
}

describe("candidate generation", () => {
  it("tilts an asset toward the positions §7 says the team can spare", () => {
    const deep = asset(1, { position: "RB", value: 1000 });
    expect(tradeability(deep, { RB: 1 })).toBeCloseTo(1350, 6);
    expect(tradeability(deep, { RB: -1 })).toBeCloseTo(650, 6);
    expect(tradeability(deep, {})).toBe(1000);
  });

  it("clamps the tilt at one standard deviation, as the waiver score does", () => {
    const deep = asset(1, { position: "RB", value: 1000 });
    expect(tradeability(deep, { RB: 4 })).toBeCloseTo(
      tradeability(deep, { RB: 1 }),
      6,
    );
  });

  it("never offers an unvalued player, and says how many it held back (§4)", () => {
    const roster = team("A", [
      asset(1, { value: 5000 }),
      asset(2, { value: 1, source: "floor" }),
      asset(3, { value: 1, source: "floor" }),
    ]);

    const { assets, unvalued } = candidateAssets(roster, 8);
    expect(assets.map((entry) => entry.playerId)).toEqual([1]);
    expect(unvalued).toBe(2);
  });

  it("never offers a kicker or a defense (§3)", () => {
    const roster = team("A", [
      asset(1, { position: "K", value: 40 }),
      asset(2, { position: "DEF", value: 40 }),
      asset(3, { position: "WR", value: 40 }),
    ]);

    const { assets, nonTradeable } = candidateAssets(roster, 8);
    expect(assets.map((entry) => entry.playerId)).toEqual([3]);
    expect(nonTradeable).toBe(2);
  });

  it("cuts to the top N and breaks ties deterministically", () => {
    const roster = team(
      "A",
      Array.from({ length: 12 }, (_, index) => asset(index + 1, { value: 500 })),
    );

    const first = candidateAssets(roster, 8).assets.map((entry) => entry.playerId);
    const shuffled = candidateAssets(
      { ...roster, roster: [...roster.roster].reverse() },
      8,
    ).assets.map((entry) => entry.playerId);

    expect(first).toHaveLength(8);
    expect(first).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled).toEqual(first);
  });

  it("enumerates §9's 36 packages from eight assets", () => {
    const assets = Array.from({ length: 8 }, (_, index) =>
      asset(index + 1, { value: (index + 1) * 100 }),
    );

    const packages = enumeratePackages(assets, WIN_WIN_LIMITS.maxPackage);
    expect(packages).toHaveLength(36);
    expect(packages.filter((entry) => entry.assets.length === 1)).toHaveLength(8);
    expect(packages.filter((entry) => entry.assets.length === 2)).toHaveLength(28);
  });

  it("enumerates §10's 298 subsets from twelve", () => {
    const assets = Array.from({ length: 12 }, (_, index) =>
      asset(index + 1, { value: (index + 1) * 100 }),
    );
    expect(enumeratePackages(assets, BUILDER_LIMITS.maxPackage)).toHaveLength(298);
  });

  it("sorts packages by their raw sum, which is what the prune bisects", () => {
    const packages = enumeratePackages(
      [asset(1, { value: 900 }), asset(2, { value: 100 }), asset(3, { value: 400 })],
      2,
    );

    const bases = packages.map((entry) => entry.base);
    expect(bases).toEqual([...bases].sort((x, y) => x - y));
    expect(bases[0]).toBe(100);
  });
});

describe("the value-window prune", () => {
  /**
   * The prune's whole claim is that it is *exact* — that a package pair it
   * skips could not have survived §6's math whatever the bonuses did. Asserted
   * the only way that claim can be asserted: by running the analyzer on the
   * pairs the window rejects and confirming every one of them is unfair.
   */
  function sweep(params: TradeParams) {
    const window = baseRatioWindow(params, 2);
    let rejected = 0;

    // A deterministic sweep rather than a random one, so a failure is a
    // reproducible case and not a seed.
    for (let x = 1; x <= 40; x += 1) {
      for (let y = 1; y <= 40; y += 1) {
        for (let z = 1; z <= 40; z += 3) {
          const a = [asset(1, { value: x * 250 }), asset(2, { value: y * 250 })];
          const b = [asset(3, { value: z * 250 })];

          const baseA = x * 250 + y * 250;
          const baseB = z * 250;
          const inside =
            baseB >= baseA * window.lo && baseB <= baseA * window.hi;
          if (inside) continue;

          rejected += 1;
          const verdict = analyzeTrade(a, b, params).verdict;
          expect(verdict).not.toBeNull();
          expect(verdict!.pct).toBeGreaterThanOrEqual(FAIR_BAND);
        }
      }
    }

    return rejected;
  }

  it("never discards a package pair that would have been fair", () => {
    expect(sweep(DEFAULT_TRADE_PARAMS)).toBeGreaterThan(1000);
  });

  it("stays exact at the far end of every slider's range", () => {
    expect(sweep({ alpha: 0.3, beta: 0.15, gamma: 0.2 })).toBeGreaterThan(1000);
  });

  it("collapses to the fairness band itself when the knobs are all zero", () => {
    const window = baseRatioWindow({ alpha: 0, beta: 0, gamma: 0 }, 2);
    expect(window.lo).toBeCloseTo(1 - FAIR_BAND, 12);
    expect(window.hi).toBeCloseTo(1 / (1 - FAIR_BAND), 12);
  });
});

describe("the win-win search (Requirement 9)", () => {
  it("finds the trade both teams are obviously looking for", () => {
    const { suggestions } = searchWinWin(mirroredLeague(), SLOTS);

    expect(suggestions.length).toBeGreaterThan(0);
    const best = suggestions[0];

    // A running back for a receiver, one for one, and both starting lineups a
    // full flex player better for it. Which of the interchangeable backs goes
    // is a genuine tie — every one of them is worth the same and moves the
    // lineup the same — and the comparator's job there is only to answer the
    // same way twice, which the determinism tests below pin.
    expect(best.a).toHaveLength(1);
    expect(best.b).toHaveLength(1);
    expect(best.a[0].position).toBe("RB");
    expect(best.b[0].position).toBe("WR");
    expect(best.lineupA.delta).toBeCloseTo(120, 6);
    expect(best.lineupB.delta).toBeCloseTo(120, 6);
    expect(best.score.minGain).toBeCloseTo(120, 6);
  });

  it("scores with the analyzer rather than beside it", () => {
    const { suggestions } = searchWinWin(mirroredLeague(), SLOTS);

    for (const suggestion of suggestions) {
      const rerun = analyzeTrade(suggestion.a, suggestion.b, DEFAULT_TRADE_PARAMS);
      expect(rerun.verdict).not.toBeNull();
      expect(rerun.verdict!.pct).toBeCloseTo(suggestion.analysis.verdict!.pct, 12);
      // The one invariant this phase cannot get wrong: nothing suggested here
      // may be a trade the analyzer would then argue against.
      expect(rerun.verdict!.pct).toBeLessThan(FAIR_BAND);
      expect(["even", "slight"]).toContain(rerun.verdict!.band);
    }
  });

  it("only suggests trades that improve both starting lineups", () => {
    const { suggestions } = searchWinWin(mirroredLeague(), SLOTS);

    for (const suggestion of suggestions) {
      expect(suggestion.lineupA.delta).toBeGreaterThan(MIN_LINEUP_GAIN);
      expect(suggestion.lineupB.delta).toBeGreaterThan(MIN_LINEUP_GAIN);
    }
  });

  it("finds nothing in a league where no win-win exists", () => {
    // Two identical rosters. Every fair trade is a swap of interchangeable
    // players, so nobody's lineup moves and §9's test is failed by all of them.
    const shape = [
      { position: "RB", points: 200 },
      { position: "WR", points: 180 },
      { position: "RB", points: 90 },
    ];
    const roster = shape.map((entry, index) => asset(index + 1, entry));
    const clone = shape.map((entry, index) => asset(index + 11, entry));

    const { suggestions, stats } = searchWinWin(
      [team("A", roster), team("B", clone)],
      SLOTS,
    );

    expect(stats.fair).toBeGreaterThan(0);
    expect(stats.winWin).toBe(0);
    expect(suggestions).toEqual([]);
  });

  it("copes with a team that has nothing to trade", () => {
    const [a, b] = mirroredLeague();
    const empty = team("C", []);
    const kdefOnly = team("D", [
      asset(21, { position: "K", points: 120, value: 30 }),
      asset(22, { position: "DEF", points: 110, value: 30 }),
    ]);
    const allUnvalued = team("E", [
      asset(31, { position: "WR", points: 150, value: 1, source: "floor" }),
      asset(32, { position: "RB", points: 140, value: 1, source: "floor" }),
    ]);

    const { suggestions, stats } = searchWinWin(
      [a, b, empty, kdefOnly, allUnvalued],
      SLOTS,
    );

    expect(stats.pairs).toBe(10);
    expect(stats.unvalued).toBe(2);
    const involved = new Set(
      suggestions.flatMap((entry) => [entry.teamA, entry.teamB]),
    );
    expect([...involved].sort()).toEqual(["A", "B"]);
  });

  it("never puts an unvalued or non-tradeable player in a package", () => {
    const [a, b] = mirroredLeague();
    a.roster.push(
      asset(5, { teamId: "A", position: "K", points: 130, value: 30 }),
      asset(6, { teamId: "A", position: "WR", points: 150, value: 1, source: "floor" }),
    );
    b.roster.push(
      asset(15, { teamId: "B", position: "DEF", points: 130, value: 30 }),
      asset(16, { teamId: "B", position: "RB", points: 150, value: 1, source: "floor" }),
    );

    const { suggestions, stats } = searchWinWin([a, b], SLOTS);
    expect(stats.unvalued).toBe(2);

    const moved = suggestions.flatMap((entry) => [...entry.a, ...entry.b]);
    expect(moved.some((player) => player.source === "floor")).toBe(false);
    expect(moved.some((player) => player.position === "K")).toBe(false);
    expect(moved.some((player) => player.position === "DEF")).toBe(false);
  });

  it("keeps a package containing a floor-valued player from ever being scored", () => {
    // The same rule from the other side: were one to slip through candidate
    // generation, §4 would refuse it a verdict and the search must drop it
    // rather than rank a `null`.
    const unvalued = asset(99, { value: 1, source: "floor", position: "RB" });
    const analysis = analyzeTrade([unvalued], [asset(1, { value: 1 })]);
    expect(analysis.verdict).toBeNull();
  });

  it("holds to §9's per-pair cap and shows different deals inside it", () => {
    const [a, b] = mirroredLeague();
    // Depth on both sides, so the pair has far more than three fair win-wins.
    a.roster.push(
      asset(7, { teamId: "A", position: "RB", points: 175 }),
      asset(8, { teamId: "A", position: "RB", points: 170 }),
    );
    b.roster.push(
      asset(17, { teamId: "B", position: "WR", points: 175 }),
      asset(18, { teamId: "B", position: "WR", points: 170 }),
    );

    const { suggestions } = searchWinWin([a, b], SLOTS);
    expect(suggestions.length).toBeLessThanOrEqual(WIN_WIN_LIMITS.perPair);

    const headliners = suggestions.map(
      (entry) =>
        `${entry.analysis.a.best?.playerId}:${entry.analysis.b.best?.playerId}`,
    );
    expect(new Set(headliners).size).toBe(headliners.length);
  });

  it("ranks by the minimum benefit, not the total (§9)", () => {
    const lopsided: Suggestion = {
      teamA: "A",
      teamB: "B",
      a: [],
      b: [],
      analysis: analyzeTrade([asset(1)], [asset(2)]),
      lineupA: { before: 0, after: 0, delta: 200, empty: 0, unprojected: 0 },
      lineupB: { before: 0, after: 0, delta: 1, empty: 0, unprojected: 0 },
      score: { minGain: 1, totalGain: 201, marketShare: 1, pct: 0, bodies: 2 },
    };
    const solid: Suggestion = {
      ...lopsided,
      score: { minGain: 40, totalGain: 90, marketShare: 1, pct: 0, bodies: 2 },
    };

    expect([lopsided, solid].sort(compareSuggestions)[0]).toBe(solid);
  });

  it("breaks a tie on provenance, then fairness, then bodies (§5, §6)", () => {
    const base = {
      teamA: "A",
      teamB: "B",
      a: [asset(1)],
      b: [asset(2)],
      analysis: analyzeTrade([asset(1)], [asset(2)]),
      lineupA: { before: 0, after: 0, delta: 10, empty: 0, unprojected: 0 },
      lineupB: { before: 0, after: 0, delta: 10, empty: 0, unprojected: 0 },
    } satisfies Omit<Suggestion, "score">;

    const modelled: Suggestion = {
      ...base,
      score: { minGain: 10, totalGain: 20, marketShare: 0.4, pct: 0.01, bodies: 2 },
    };
    const priced: Suggestion = {
      ...base,
      score: { minGain: 10, totalGain: 20, marketShare: 1, pct: 0.02, bodies: 2 },
    };
    expect([modelled, priced].sort(compareSuggestions)[0]).toBe(priced);

    const even: Suggestion = {
      ...base,
      score: { minGain: 10, totalGain: 20, marketShare: 1, pct: 0.001, bodies: 4 },
    };
    const tilted: Suggestion = {
      ...base,
      score: { minGain: 10, totalGain: 20, marketShare: 1, pct: 0.05, bodies: 2 },
    };
    expect([tilted, even].sort(compareSuggestions)[0]).toBe(even);

    const lean: Suggestion = {
      ...base,
      a: [asset(1)],
      score: { minGain: 10, totalGain: 20, marketShare: 1, pct: 0.02, bodies: 2 },
    };
    const bulky: Suggestion = {
      ...base,
      a: [asset(1), asset(3)],
      score: { minGain: 10, totalGain: 20, marketShare: 1, pct: 0.02, bodies: 4 },
    };
    expect([bulky, lean].sort(compareSuggestions)[0]).toBe(lean);
  });

  it("orders two identical scores the same way whatever order they arrive in", () => {
    const shape = {
      teamA: "A",
      teamB: "B",
      analysis: analyzeTrade([asset(1)], [asset(2)]),
      lineupA: { before: 0, after: 0, delta: 10, empty: 0, unprojected: 0 },
      lineupB: { before: 0, after: 0, delta: 10, empty: 0, unprojected: 0 },
      score: { minGain: 10, totalGain: 20, marketShare: 1, pct: 0.02, bodies: 2 },
    };

    const first: Suggestion = { ...shape, a: [asset(7)], b: [asset(20)] };
    const second: Suggestion = { ...shape, a: [asset(9)], b: [asset(20)] };

    expect([first, second].sort(compareSuggestions)[0]).toBe(first);
    expect([second, first].sort(compareSuggestions)[0]).toBe(first);
    // And float dust is not a difference: a minimum gain that differs in the
    // fourteenth decimal must not reorder the board on the next sync.
    const jittered: Suggestion = {
      ...second,
      score: { ...shape.score, minGain: 10 + 1e-14 },
    };
    expect([jittered, first].sort(compareSuggestions)[0]).toBe(first);
  });

  it("is deterministic across a shuffled league", () => {
    const forwards = searchWinWin(mirroredLeague(), SLOTS).suggestions;
    const backwards = searchWinWin([...mirroredLeague()].reverse(), SLOTS)
      .suggestions;

    const key = (suggestion: Suggestion) =>
      [...suggestion.a, ...suggestion.b]
        .map((entry) => entry.playerId)
        .sort((x, y) => x - y)
        .join(",");

    expect(backwards.map(key)).toEqual(forwards.map(key));
  });

  it("stays inside §9's stated search space on a full twelve-team league", () => {
    const { stats } = searchWinWin(syntheticLeague(12, 15), SLOTS);

    expect(stats.pairs).toBe(66);
    // 66 pairs × 36 × 36. The prune is what stands between that and the work
    // actually done, and it is only ever allowed to make the number smaller.
    expect(stats.evaluated + stats.pruned).toBe(66 * 36 * 36);
    expect(stats.evaluated).toBeLessThan(66 * 36 * 36);
  });
});

describe("the player-based builder (Requirement 10)", () => {
  function builderLeague() {
    const mine = team(
      "MINE",
      [
        asset(1, { position: "RB", points: 200, value: 4200 }),
        asset(2, { position: "RB", points: 150, value: 2600 }),
        asset(3, { position: "RB", points: 120, value: 1800 }),
        asset(4, { position: "WR", points: 110, value: 1500 }),
        asset(5, { position: "TE", points: 80, value: 900 }),
      ],
      { surplusZ: { RB: 1.4 }, need: { WR: 1.1, TE: 0.2 } },
    );

    const theirs = team(
      "THEIRS",
      [
        asset(11, { position: "WR", points: 210, value: 4300 }),
        asset(12, { position: "WR", points: 140, value: 2200 }),
        asset(13, { position: "RB", points: 70, value: 700 }),
      ],
      { surplusZ: { WR: 1.3 }, need: { RB: 0.9 } },
    );

    return { mine, theirs };
  }

  it("returns a menu rather than an answer, all of it fair by value", () => {
    const { mine, theirs } = builderLeague();
    const { suggestions, stats } = buildPackages(
      { target: theirs.roster[0], from: theirs, to: mine },
      SLOTS,
    );

    expect(suggestions.length).toBeGreaterThan(1);
    expect(suggestions.length).toBeLessThanOrEqual(BUILDER_LIMITS.results);
    expect(stats.askingPrice).toBeCloseTo(4300 * (1 + DEFAULT_TRADE_PARAMS.alpha), 6);

    for (const suggestion of suggestions) {
      expect(suggestion.b.map((entry) => entry.playerId)).toEqual([11]);
      expect(suggestion.analysis.verdict!.pct).toBeLessThan(FAIR_BAND);
    }
  });

  it("ranks on the user's own lineup delta (§10)", () => {
    const { mine, theirs } = builderLeague();
    const { suggestions } = buildPackages(
      { target: theirs.roster[0], from: theirs, to: mine },
      SLOTS,
    );

    const deltas = suggestions.map((entry) => entry.lineupA.delta);
    expect(deltas).toEqual([...deltas].sort((x, y) => y - x));
  });

  it("does not spend players at a position §7 says the user is thin at", () => {
    const { mine, theirs } = builderLeague();
    const { suggestions, stats } = buildPackages(
      { target: theirs.roster[0], from: theirs, to: mine },
      SLOTS,
    );

    // The receiver is a need at +1.1; the tight end at +0.2 is inside the noise
    // and stays available.
    expect(stats.protectedPieces).toBe(1);
    expect(stats.relaxed).toBe(false);
    const offered = suggestions.flatMap((entry) => entry.a);
    expect(offered.some((player) => player.playerId === 4)).toBe(false);
  });

  it("drops the need exclusion rather than refusing to answer", () => {
    const mine = team(
      "MINE",
      [
        asset(1, { position: "RB", points: 200, value: 4200 }),
        asset(2, { position: "RB", points: 150, value: 2600 }),
      ],
      { need: { RB: 2.4 } },
    );
    const theirs = team("THEIRS", [
      asset(11, { position: "WR", points: 210, value: 4300 }),
    ]);

    const { suggestions, stats } = buildPackages(
      { target: theirs.roster[0], from: theirs, to: mine },
      SLOTS,
    );

    expect(stats.relaxed).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("refuses to price an unvalued target (§4)", () => {
    const { mine, theirs } = builderLeague();
    const target = { ...theirs.roster[0], source: "floor" as const, value: 1 };

    const { suggestions, stats } = buildPackages(
      { target, from: theirs, to: mine },
      SLOTS,
    );

    expect(stats.blocked).toBe("unvalued");
    expect(suggestions).toEqual([]);
  });

  it("says so when the user has nothing to offer", () => {
    const mine = team("MINE", [
      asset(1, { position: "K", points: 130, value: 40 }),
      asset(2, { position: "WR", points: 130, value: 1, source: "floor" }),
    ]);
    const theirs = team("THEIRS", [
      asset(11, { position: "WR", points: 210, value: 4300 }),
    ]);

    const { suggestions, stats } = buildPackages(
      { target: theirs.roster[0], from: theirs, to: mine },
      SLOTS,
    );

    expect(stats.blocked).toBe("no-pieces");
    expect(stats.unvalued).toBe(1);
    expect(suggestions).toEqual([]);
  });

  it("does not offer the same package twice with a throw-in bolted on", () => {
    const { mine, theirs } = builderLeague();
    const { suggestions } = buildPackages(
      { target: theirs.roster[0], from: theirs, to: mine },
      SLOTS,
    );

    const sets = suggestions.map(
      (entry) => new Set(entry.a.map((player) => player.playerId)),
    );

    for (let i = 0; i < sets.length; i += 1) {
      for (let j = i + 1; j < sets.length; j += 1) {
        const [small, large] =
          sets[i].size <= sets[j].size ? [sets[i], sets[j]] : [sets[j], sets[i]];
        const subset = [...small].every((id) => large.has(id));
        expect(subset && small.size < large.size).toBe(false);
      }
    }
  });

  it("carries provenance into every package it proposes (§5)", () => {
    const mine = team("MINE", [
      asset(1, { position: "RB", points: 150, value: 2100, source: "model" }),
      asset(2, { position: "RB", points: 140, value: 2100, source: "market" }),
      asset(3, { position: "RB", points: 130, value: 2000, source: "model" }),
    ]);
    const theirs = team("THEIRS", [
      asset(11, { position: "WR", points: 210, value: 4200, source: "market" }),
    ]);

    const { suggestions } = buildPackages(
      { target: theirs.roster[0], from: theirs, to: mine },
      SLOTS,
    );

    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.score.marketShare).toBeGreaterThan(0);
      expect(suggestion.score.marketShare).toBeLessThan(1);
      // The share reported is the analyzer's own, not a second count of it.
      expect(suggestion.score.marketShare).toBeCloseTo(
        suggestion.analysis.marketShare,
        12,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// a league big enough to time
// ---------------------------------------------------------------------------

/**
 * A deterministic twelve-team league on a realistic value curve — a #1 near
 * 10,000 falling away convexly, the way FantasyCalc's does. No randomness: a
 * timing test that fails on a seed tells nobody anything.
 */
function syntheticLeague(teams: number, size: number): SuggestionTeam[] {
  const positions = ["QB", "RB", "WR", "TE", "RB", "WR"];
  const built: SuggestionTeam[] = [];

  for (let t = 0; t < teams; t += 1) {
    const roster: SuggestionAsset[] = [];

    for (let p = 0; p < size; p += 1) {
      const overall = p * teams + ((t * 7) % teams) + 1;
      roster.push(
        asset(t * 100 + p + 1, {
          teamId: `T${t}`,
          position: positions[(t + p) % positions.length],
          value: Math.round(10_000 * Math.exp(-overall / 28)) + 1,
          points: Math.round(320 * Math.exp(-overall / 55)),
        }),
      );
    }

    built.push(
      team(`T${t}`, roster, {
        surplusZ: { RB: ((t % 5) - 2) / 2, WR: ((t % 3) - 1) / 2 },
        need: { RB: (2 - (t % 5)) / 2, WR: (1 - (t % 3)) / 2 },
      }),
    );
  }

  return built;
}

describe("§9's stage budget", () => {
  it("searches a twelve-team league well inside one sync stage", () => {
    const league = syntheticLeague(12, 15);

    const started = Date.now();
    const { stats } = searchWinWin(league, SLOTS);
    const elapsed = Date.now() - started;

    expect(stats.evaluated).toBeGreaterThan(0);
    // §9 caps a stage at ~60s and stage 8 already spends most of it on the
    // valuation and the needs vector. Five seconds is a ceiling with an order
    // of magnitude of headroom over what this actually costs, chosen so the
    // assertion fails on a regression rather than on a busy CI box.
    expect(elapsed).toBeLessThan(5000);
  });

  it("solves each roster's starting lineup once, not once per candidate", () => {
    // The hoist is the reason the search fits. Asserted structurally: the
    // "before" lineup a suggestion reports is the roster's own, unchanged by
    // whichever package it was measured against.
    const [a, b] = mirroredLeague();
    const { suggestions } = searchWinWin([a, b], SLOTS);

    for (const suggestion of suggestions) {
      expect(suggestion.lineupA.before).toBeCloseTo(
        bestLineup(a.roster, SLOTS).points,
        9,
      );
      expect(suggestion.lineupB.before).toBeCloseTo(
        bestLineup(b.roster, SLOTS).points,
        9,
      );
    }
  });
});

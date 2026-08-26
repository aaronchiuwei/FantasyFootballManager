import { describe, expect, it } from "vitest";

import type { ValueSource } from "@/lib/values/engine";

import {
  analyzeTrade,
  bandFor,
  BAND_THRESHOLDS,
  DEFAULT_TRADE_PARAMS,
  FULL_TILT_PCT,
  type TradeAsset,
  type TradeParams,
} from "./analyze";

/**
 * Values on FantasyCalc's real scale — a #1 overall of ~10,700 down to a
 * market floor of 1 — because the bands are ratios and a toy scale would hide
 * the thing §6 is actually worried about: a curve whose top 100 hold 92% of
 * all value already prices the superstar premium once.
 */
function asset(
  playerId: number,
  value: number,
  {
    source = "market",
    position = "RB",
  }: { source?: ValueSource; position?: string | null } = {},
): TradeAsset {
  return { playerId, value, source, position };
}

const { alpha, beta, gamma } = DEFAULT_TRADE_PARAMS;

/** Alpha only, for reading the expected numbers back out by hand. */
const NO_HEADLINE: TradeParams = { ...DEFAULT_TRADE_PARAMS, gamma: 0 };

describe("side totals", () => {
  it("sums the raw values before any adjustment", () => {
    const { a } = analyzeTrade([asset(1, 4000), asset(2, 1500)], [asset(3, 5000)]);
    expect(a.base).toBe(5500);
  });

  it("pays the best-player bonus in proportion, not flat (§6)", () => {
    const { a } = analyzeTrade([asset(1, 6000), asset(2, 900)], [asset(3, 7000)]);
    expect(a.best?.playerId).toBe(1);
    expect(a.bonus).toBeCloseTo(alpha * 6000, 6);
  });

  it("charges no depth penalty for a single player", () => {
    const { a } = analyzeTrade([asset(1, 5000)], [asset(2, 5000)]);
    expect(a.depthPenalty).toBe(0);
    expect(a.total).toBeCloseTo(5000 * (1 + alpha), 6);
  });

  it("charges the depth penalty per extra body, against the median (§6)", () => {
    const { a } = analyzeTrade(
      [asset(1, 5000), asset(2, 3000), asset(3, 1000)],
      [asset(4, 9000)],
    );
    expect(a.median).toBe(3000);
    expect(a.depthPenalty).toBeCloseTo(beta * 2 * 3000, 6);
  });

  it("takes the median of an even-sized package as the midpoint", () => {
    const { a } = analyzeTrade(
      [asset(1, 4000), asset(2, 3000), asset(3, 2000), asset(4, 1000)],
      [asset(5, 9000)],
    );
    expect(a.median).toBe(2500);
    expect(a.depthPenalty).toBeCloseTo(beta * 3 * 2500, 6);
  });

  /**
   * The bug the difference-based charge exists to kill: two three-player
   * packages, equal in value, where one side's middle player is cheaper. On
   * the per-side form each side is billed `beta × 2 × its own median`, the
   * bills differ, and a dead-even trade acquires a winner out of nowhere.
   */
  it("charges nothing when both sides send the same number of players", () => {
    const { a, b, verdict } = analyzeTrade(
      [asset(1, 6000), asset(2, 3000), asset(3, 1000)],
      [asset(4, 6000), asset(5, 2000), asset(6, 2000)],
    );

    expect(a.depthPenalty).toBe(0);
    expect(b.depthPenalty).toBe(0);
    expect(a.median).not.toBe(b.median);
    expect(verdict?.band).toBe("even");
    expect(verdict?.winner).toBeNull();
  });

  it("charges only the side sending more, and only for the surplus bodies", () => {
    const { a, b } = analyzeTrade(
      [asset(1, 5000), asset(2, 3000), asset(3, 1000)],
      [asset(4, 6000), asset(5, 2000)],
    );

    // Three for two: one body of consolidation, not two.
    expect(a.depthPenalty).toBeCloseTo(beta * 1 * 3000, 6);
    expect(b.depthPenalty).toBe(0);
  });

  it("assembles the total as base + bonus − penalty", () => {
    const { a } = analyzeTrade(
      [asset(1, 5000), asset(2, 3000)],
      [asset(3, 8200)],
      NO_HEADLINE,
    );
    expect(a.total).toBeCloseTo(8000 + alpha * 5000 - beta * 1 * 4000, 6);
  });
});

describe("the headline premium (gamma)", () => {
  it("goes to the side holding the best player in the deal", () => {
    const { a, b } = analyzeTrade([asset(1, 9000)], [asset(2, 4000)]);
    expect(a.headlineBonus).toBeCloseTo(gamma * (9000 - 4000), 6);
    expect(b.headlineBonus).toBe(0);
  });

  it("collapses to nothing between equal headliners", () => {
    const { a, b } = analyzeTrade(
      [asset(1, 7000), asset(2, 200)],
      [asset(3, 7000)],
    );
    expect(a.headlineBonus).toBe(0);
    expect(b.headlineBonus).toBe(0);
  });

  /**
   * The property the departure from §6's literal formula exists to protect: a
   * one-point difference between headliners must not swing a verdict. On the
   * full-value form this jumps by 5% of a first-round pick.
   */
  it("is continuous across the point where the headliner changes hands", () => {
    const just = analyzeTrade([asset(1, 8000)], [asset(2, 7999)]);
    const other = analyzeTrade([asset(1, 8000)], [asset(2, 8001)]);

    expect(Math.abs(just.verdict!.pct - other.verdict!.pct)).toBeLessThan(0.001);
    expect(just.verdict?.band).toBe("even");
    expect(other.verdict?.band).toBe("even");
  });

  it("can be tuned away entirely", () => {
    const { a } = analyzeTrade([asset(1, 9000)], [asset(2, 4000)], NO_HEADLINE);
    expect(a.headlineBonus).toBe(0);
  });
});

describe("fairness bands (§6)", () => {
  it("maps pct onto the four bands at the stated boundaries", () => {
    expect(bandFor(0)).toBe("even");
    expect(bandFor(BAND_THRESHOLDS.even - 0.0001)).toBe("even");
    expect(bandFor(BAND_THRESHOLDS.even)).toBe("slight");
    expect(bandFor(BAND_THRESHOLDS.slight - 0.0001)).toBe("slight");
    expect(bandFor(BAND_THRESHOLDS.slight)).toBe("clear");
    expect(bandFor(BAND_THRESHOLDS.clear - 0.0001)).toBe("clear");
    expect(bandFor(BAND_THRESHOLDS.clear)).toBe("lopsided");
    expect(bandFor(1)).toBe("lopsided");
  });

  it("calls an exactly equal trade even, with no winner", () => {
    const { verdict } = analyzeTrade([asset(1, 5000)], [asset(2, 5000)]);
    expect(verdict?.band).toBe("even");
    expect(verdict?.winner).toBeNull();
    expect(verdict?.delta).toBe(0);
    expect(verdict?.tilt).toBe(0);
  });

  it("measures the margin against the heavier side", () => {
    // Alpha is proportional, so a 1-for-1 keeps the raw ratio exactly.
    const { verdict } = analyzeTrade(
      [asset(1, 9000)],
      [asset(2, 8100)],
      NO_HEADLINE,
    );
    expect(verdict?.pct).toBeCloseTo(0.1, 6);
    expect(verdict?.winner).toBe("a");
    expect(verdict?.band).toBe("clear");
  });

  it("mirrors exactly when the sides are swapped", () => {
    const forward = analyzeTrade(
      [asset(1, 6000), asset(2, 1200)],
      [asset(3, 8000)],
    );
    const reversed = analyzeTrade(
      [asset(3, 8000)],
      [asset(1, 6000), asset(2, 1200)],
    );

    expect(reversed.verdict?.pct).toBeCloseTo(forward.verdict!.pct, 9);
    expect(reversed.verdict?.delta).toBeCloseTo(-forward.verdict!.delta, 9);
    expect(reversed.verdict?.tilt).toBeCloseTo(-forward.verdict!.tilt, 9);
    expect(reversed.verdict?.band).toBe(forward.verdict?.band);
    expect(reversed.verdict?.winner).toBe(
      forward.verdict?.winner === "a" ? "b" : "a",
    );
  });
});

describe("the beam's tilt (§10)", () => {
  it("points at the side that is ahead", () => {
    expect(analyzeTrade([asset(1, 9000)], [asset(2, 6000)]).verdict!.tilt)
      .toBeGreaterThan(0);
    expect(analyzeTrade([asset(1, 6000)], [asset(2, 9000)]).verdict!.tilt)
      .toBeLessThan(0);
  });

  it("saturates rather than pinning at the band boundary", () => {
    const bad = analyzeTrade([asset(1, 10000)], [asset(2, 1000)]).verdict!;
    expect(bad.pct).toBeGreaterThan(FULL_TILT_PCT);
    expect(bad.tilt).toBe(1);
  });

  it("is linear in pct below saturation", () => {
    const { verdict } = analyzeTrade(
      [asset(1, 10000)],
      [asset(2, 9000)],
      NO_HEADLINE,
    );
    expect(verdict!.tilt).toBeCloseTo(verdict!.pct / FULL_TILT_PCT, 9);
  });
});

describe("refusing a verdict", () => {
  it("refuses on an empty trade rather than declaring it even", () => {
    const { verdict, blocks } = analyzeTrade([], []);
    expect(verdict).toBeNull();
    expect(blocks).toEqual([{ kind: "empty", side: "both" }]);
  });

  /**
   * A half-built trade is incomplete, not lopsided. Shouting "LOPSIDED" at a
   * user who has added one player and is reaching for the second is a
   * calculator arguing with its own loading state.
   */
  it("refuses while one side is still empty", () => {
    const { verdict, blocks } = analyzeTrade([asset(1, 5000)], []);
    expect(verdict).toBeNull();
    expect(blocks).toEqual([{ kind: "empty", side: "b" }]);
  });

  /** §4's non-negotiable rule, and the reason `verdict` is nullable at all. */
  it("refuses when an unvalued player is in the deal", () => {
    const { verdict, blocks, a } = analyzeTrade(
      [asset(1, 5000), asset(2, 1, { source: "floor" })],
      [asset(3, 5200)],
    );

    expect(verdict).toBeNull();
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "unvalued", side: "a" });
    expect(a.unvalued.map((entry) => entry.playerId)).toEqual([2]);
  });

  it("names the unvalued players on both sides", () => {
    const { blocks } = analyzeTrade(
      [asset(1, 1, { source: "floor" })],
      [asset(2, 1, { source: "floor" }), asset(3, 4000)],
    );

    expect(blocks.map((block) => block.side)).toEqual(["a", "b"]);
  });

  it("still totals both sides, so the UI has something to show", () => {
    const { a, b } = analyzeTrade(
      [asset(1, 5000), asset(2, 1, { source: "floor" })],
      [asset(3, 5200)],
    );
    expect(a.base).toBe(5001);
    expect(b.base).toBe(5200);
  });
});

describe("provenance reaching the verdict (§5)", () => {
  it("weights market share by value, not by headcount", () => {
    const { marketShare } = analyzeTrade(
      [asset(1, 9000), asset(2, 200, { source: "model" })],
      [asset(3, 9100)],
    );
    // 18,100 of 18,300 on the table carries a market price.
    expect(marketShare).toBeCloseTo(18100 / 18300, 6);
  });

  it("gives an all-market trade no error bars at all", () => {
    const { verdict } = analyzeTrade([asset(1, 9000)], [asset(2, 8100)]);
    expect(verdict?.noisePct).toBe(0);
    expect(verdict?.withinNoise).toBe(false);
    expect(verdict?.band).toBe("clear");
  });

  /**
   * §5 says a trade built on model values is a fuzzier trade. Here the fuzz is
   * larger than the margin, so the band is still reported — it is what the
   * numbers say — but the analyzer admits the edge may not be real.
   */
  it("flags a margin smaller than the modelled values' own error", () => {
    const { verdict } = analyzeTrade(
      [asset(1, 180, { source: "model" })],
      [asset(2, 150, { source: "model" })],
    );

    expect(verdict?.band).toBe("lopsided");
    expect(verdict?.withinNoise).toBe(true);
    expect(verdict?.noisePct).toBeGreaterThan(verdict!.pct);
  });

  it("does not flag an even verdict as uncertain", () => {
    const { verdict } = analyzeTrade(
      [asset(1, 200, { source: "model" })],
      [asset(2, 200, { source: "model" })],
    );
    expect(verdict?.band).toBe("even");
    expect(verdict?.withinNoise).toBe(false);
  });

  it("barely widens the error bars when the modelled piece is small", () => {
    const { verdict } = analyzeTrade(
      [asset(1, 8000)],
      [asset(2, 7000), asset(3, 400, { source: "model" })],
    );
    expect(verdict?.noisePct).toBeLessThan(0.02);
    expect(verdict?.withinNoise).toBe(false);
  });
});

describe("kickers and defenses (§3)", () => {
  it("flags them without refusing a verdict", () => {
    const { b, verdict } = analyzeTrade(
      [asset(1, 4000, { position: "WR" })],
      [
        asset(2, 3900, { position: "WR" }),
        asset(3, 3, { source: "model_capped", position: "K" }),
        asset(4, 3, { source: "model_capped", position: "DEF" }),
      ],
    );

    expect(b.nonTradeAssets.map((entry) => entry.playerId)).toEqual([3, 4]);
    expect(verdict).not.toBeNull();
  });

  it("cannot move a verdict, because the value engine already priced them at the market floor", () => {
    const without = analyzeTrade(
      [asset(1, 4000, { position: "WR" })],
      [asset(2, 3900, { position: "WR" })],
    );
    const padded = analyzeTrade(
      [asset(1, 4000, { position: "WR" })],
      [
        asset(2, 3900, { position: "WR" }),
        asset(3, 3, { source: "model_capped", position: "K" }),
        asset(4, 3, { source: "model_capped", position: "DEF" }),
      ],
    );

    expect(padded.verdict?.band).toBe(without.verdict?.band);
    expect(Math.abs(padded.verdict!.pct - without.verdict!.pct)).toBeLessThan(0.01);
  });

  it("does not call an unknown position a non-trade asset", () => {
    const { a } = analyzeTrade(
      [asset(1, 4000, { position: null })],
      [asset(2, 4000)],
    );
    expect(a.nonTradeAssets).toEqual([]);
  });
});

describe("the caller's own asset type survives the math", () => {
  it("returns the rows it was given, not copies stripped to the math's shape", () => {
    type Rich = TradeAsset & { name: string };
    const chase: Rich = { ...asset(1, 9000), name: "Ja'Marr Chase" };

    const { a } = analyzeTrade<Rich>(
      [chase],
      [{ ...asset(2, 8000), name: "Bijan Robinson" }],
    );

    expect(a.best?.name).toBe("Ja'Marr Chase");
    expect(a.assets[0]).toBe(chase);
  });
});

/**
 * §13: "golden-file tests on hand-checked trades, including the adversarial
 * ones — 4-for-1 packages, two-superstar swaps, K/DEF-inflated junk — to
 * confirm α/β are sane."
 *
 * These are the calibration mechanism, not a regression net. If a knob's
 * default moves, the expectation that changes here is the argument for or
 * against the move.
 */
describe("golden trades (§13)", () => {
  const cases: {
    name: string;
    a: TradeAsset[];
    b: TradeAsset[];
    band: string;
    winner: "a" | "b" | null;
    why: string;
  }[] = [
    {
      name: "two comparable superstars swap",
      a: [asset(1, 8000)],
      b: [asset(2, 7800)],
      band: "even",
      winner: null,
      why: "both bonuses are proportional, so a 2.5% gap stays a 2.5% gap",
    },
    {
      name: "elite for the second tier",
      a: [asset(1, 9000)],
      b: [asset(2, 6000)],
      band: "lopsided",
      winner: "a",
      why: "the curve is convex; 3,000 points of value is not close",
    },
    {
      name: "value-matched two-for-one",
      a: [asset(1, 6000), asset(2, 2400)],
      b: [asset(3, 8200)],
      band: "even",
      winner: null,
      why: "the extra body costs a little depth, the headliner earns a little back",
    },
    {
      name: "four-for-one at equal raw value",
      a: [asset(1, 9000)],
      b: [asset(2, 2250), asset(3, 2250), asset(4, 2250), asset(5, 2250)],
      band: "clear",
      winner: "a",
      why: "Requirement 6: at equal sums, the side with the best player wins",
    },
    {
      name: "four-for-one where the pile pays a premium",
      a: [asset(1, 9000)],
      b: [asset(2, 2600), asset(3, 2500), asset(4, 2400), asset(5, 2300)],
      band: "even",
      winner: null,
      why: "consolidating costs about 9% — the premium the requirement describes",
    },
    {
      name: "K/DEF-padded junk",
      a: [asset(1, 4000, { position: "WR" })],
      b: [
        asset(2, 3900, { position: "WR" }),
        asset(3, 3, { source: "model_capped", position: "K" }),
        asset(4, 3, { source: "model_capped", position: "DEF" }),
      ],
      band: "even",
      winner: null,
      why: "streamed positions are worth the market's floor and cannot pad a package",
    },
    {
      name: "deep bench for deep bench, both modelled",
      a: [asset(6, 180, { source: "model" })],
      b: [asset(7, 150, { source: "model" })],
      band: "lopsided",
      winner: "a",
      why: "the band is honest about the numbers; withinNoise is honest about the numbers' quality",
    },
    {
      name: "the salary dump",
      a: [asset(1, 7000), asset(2, 6800)],
      b: [asset(3, 9500)],
      band: "lopsided",
      winner: "a",
      why: "two startable pieces for one stud is a big overpay on this curve",
    },
  ];

  for (const scenario of cases) {
    it(`${scenario.name}: ${scenario.band} — ${scenario.why}`, () => {
      const { verdict } = analyzeTrade(scenario.a, scenario.b);
      expect(verdict).not.toBeNull();
      expect(verdict?.band).toBe(scenario.band);
      expect(verdict?.winner).toBe(scenario.winner);
    });
  }

  /**
   * The adversarial case §6 names outright: without the depth penalty the
   * calculator "will happily approve 4-for-1 packages that no real manager
   * would accept".
   */
  it("prices a package down as bodies are added to it", () => {
    const one = analyzeTrade([asset(1, 4000)], [asset(9, 4000)]).a.total;
    const three = analyzeTrade(
      [asset(1, 4000), asset(2, 2000), asset(3, 2000)],
      [asset(9, 8000)],
    ).a;

    expect(three.total).toBeLessThan(three.base + three.bonus);
    expect(three.total - one).toBeLessThan(4000);
  });
});

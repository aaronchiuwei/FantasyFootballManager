import { describe, expect, it } from "vitest";

import {
  baselineAt,
  eligiblePositions,
  replacementRanks,
  restOfSeasonPoints,
  starterCounts,
  type StartingSlot,
} from "./vor";

function slot(position: string, count = 1, isStarting = true): StartingSlot {
  return { position, count, isStarting };
}

/** A standard Yahoo 12-team redraft league. */
const STANDARD: StartingSlot[] = [
  slot("QB"),
  slot("WR", 2),
  slot("RB", 2),
  slot("TE"),
  slot("W/R/T"),
  slot("K"),
  slot("DEF"),
  slot("BN", 6, false),
  slot("IR", 2, false),
];

describe("eligiblePositions", () => {
  it("reads a named slot as itself", () => {
    expect(eligiblePositions("RB")).toEqual(["RB"]);
    expect(eligiblePositions("qb")).toEqual(["QB"]);
  });

  it("expands Yahoo's slash-joined flex slots", () => {
    expect(eligiblePositions("W/R/T").sort()).toEqual(["RB", "TE", "WR"]);
    expect(eligiblePositions("Q/W/R/T").sort()).toEqual(["QB", "RB", "TE", "WR"]);
    expect(eligiblePositions("W/R").sort()).toEqual(["RB", "WR"]);
    expect(eligiblePositions("FLEX").sort()).toEqual(["RB", "TE", "WR"]);
  });

  it("does not mistake D/ST for a flex slot", () => {
    expect(eligiblePositions("D/ST")).toEqual([]);
  });

  it("ignores slots VOR has no opinion about", () => {
    expect(eligiblePositions("BN")).toEqual([]);
    expect(eligiblePositions("")).toEqual([]);
  });
});

describe("starterCounts", () => {
  it("splits a standard flex ~0.5 RB / 0.4 WR / 0.1 TE, as §5 specifies", () => {
    const counts = starterCounts(STANDARD);

    expect(counts.RB).toBeCloseTo(2.5, 6);
    expect(counts.WR).toBeCloseTo(2.4, 6);
    expect(counts.TE).toBeCloseTo(1.1, 6);
    expect(counts.QB).toBe(1);
  });

  it("treats a superflex slot as very nearly a second QB slot", () => {
    const counts = starterCounts([slot("QB"), slot("Q/W/R/T")]);
    expect(counts.QB).toBeGreaterThan(1.8);
  });

  it("ignores bench and IR slots", () => {
    expect(starterCounts([slot("BN", 6, false), slot("IR", 2, false)])).toEqual({
      QB: 0,
      RB: 0,
      WR: 0,
      TE: 0,
    });
  });
});

describe("replacementRanks", () => {
  it("is teams × starters, so RB replacement is the 30th RB in a 12-team league", () => {
    const ranks = replacementRanks(STANDARD, 12);

    expect(ranks.RB).toBeCloseTo(30, 6);
    expect(ranks.WR).toBeCloseTo(28.8, 6);
    expect(ranks.QB).toBeCloseTo(12, 6);
  });

  it("scales with league size", () => {
    expect(replacementRanks(STANDARD, 10).QB).toBeCloseTo(10, 6);
  });

  it("never drops below rank 1, even for a position nobody starts", () => {
    expect(replacementRanks([slot("QB")], 12).TE).toBe(1);
  });
});

describe("baselineAt", () => {
  const points = [300, 250, 200, 150, 100];

  it("interpolates a fractional rank", () => {
    expect(baselineAt(points, 2.5)).toBeCloseTo(225, 6);
  });

  it("returns an exact rank exactly", () => {
    expect(baselineAt(points, 3)).toBe(200);
  });

  it("holds at the ends rather than extrapolating to zero", () => {
    expect(baselineAt(points, 0.5)).toBe(300);
    expect(baselineAt(points, 99)).toBe(100);
    expect(baselineAt([], 3)).toBe(0);
  });
});

describe("restOfSeasonPoints", () => {
  it("is the projection scaled by weeks remaining before any games are played", () => {
    expect(
      restOfSeasonPoints({
        projectedPoints: 170,
        actualPoints: null,
        gamesPlayed: 0,
        weeksRemaining: 17,
      }),
    ).toBeCloseTo(170, 6);

    expect(
      restOfSeasonPoints({
        projectedPoints: 170,
        actualPoints: null,
        gamesPlayed: null,
        weeksRemaining: 8,
      }),
    ).toBeCloseTo(80, 6);
  });

  it("blends actual pace in at min(0.7, games/10)", () => {
    // 5 games at 20/game is a 340-point pace against a 170-point projection,
    // so a weight of 0.5 lands exactly halfway between them.
    expect(
      restOfSeasonPoints({
        projectedPoints: 170,
        actualPoints: 100,
        gamesPlayed: 5,
        weeksRemaining: 17,
      }),
    ).toBeCloseTo(255, 6);
  });

  it("caps the actuals weight at 0.7 no matter how many games are played", () => {
    const late = restOfSeasonPoints({
      projectedPoints: 170,
      actualPoints: 340,
      gamesPlayed: 17,
      weeksRemaining: 17,
    });

    // 0.3 × 170 + 0.7 × 340 = 289 — the projection still carries 30%.
    expect(late).toBeCloseTo(289, 6);
  });

  it("has nothing to say about a player with neither a projection nor a game", () => {
    expect(
      restOfSeasonPoints({
        projectedPoints: null,
        actualPoints: null,
        gamesPlayed: null,
        weeksRemaining: 17,
      }),
    ).toBeNull();
  });
});

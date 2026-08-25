import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAMBDA,
  LAMBDA_LIMITS,
  NEED_CLAMP,
  needMultiplier,
  rankWaivers,
  type WaiverCandidate,
} from "./score";

let nextId = 1;

function candidate(position: string | null, rosPoints: number | null): WaiverCandidate {
  return { playerId: nextId++, position, rosPoints };
}

const NO_NEEDS = new Map<string, number>();

describe("needMultiplier", () => {
  it("is 1 for a team of exactly average strength at the position", () => {
    expect(needMultiplier(0, DEFAULT_LAMBDA)).toBe(1);
  });

  it("is 1 for every position when lambda is zero", () => {
    expect(needMultiplier(2, 0)).toBe(1);
    expect(needMultiplier(-2, 0)).toBe(1);
  });

  it("is §7's `1 + λ × need`", () => {
    expect(needMultiplier(0.6, 0.5)).toBeCloseTo(1.3, 6);
    expect(needMultiplier(-0.6, 0.5)).toBeCloseTo(0.7, 6);
  });

  it("stops reading past one standard deviation", () => {
    expect(needMultiplier(3, 1)).toBe(needMultiplier(NEED_CLAMP, 1));
    expect(needMultiplier(-3, 1)).toBe(needMultiplier(-NEED_CLAMP, 1));
  });

  it("never inverts the ranking, however deep the position is", () => {
    for (let lambda = 0; lambda <= LAMBDA_LIMITS.max; lambda += 0.05) {
      expect(needMultiplier(-9, lambda)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("rankWaivers", () => {
  it("ranks on rest-of-season projection when no position is a need (§7)", () => {
    const best = candidate("WR", 90);
    const mid = candidate("RB", 60);
    const worst = candidate("TE", 30);

    const picks = rankWaivers([mid, worst, best], NO_NEEDS, DEFAULT_LAMBDA);
    expect(picks.map((pick) => pick.candidate)).toEqual([best, mid, worst]);
    expect(picks.every((pick) => pick.multiplier === 1)).toBe(true);
    expect(picks[0].score).toBe(90);
  });

  it("lifts a position the team is thin at above a better projection", () => {
    const streamer = candidate("RB", 80);
    const better = candidate("WR", 95);

    // One standard deviation thin at RB, one deep at WR.
    const needs = new Map([
      ["RB", 1],
      ["WR", -1],
    ]);

    const picks = rankWaivers([better, streamer], needs, 0.5);
    expect(picks[0].candidate).toBe(streamer);
    expect(picks[0].score).toBeCloseTo(80 * 1.5, 6);
    expect(picks[1].score).toBeCloseTo(95 * 0.5, 6);
  });

  it("leaves the ordering alone at lambda zero, however lopsided the needs", () => {
    const better = candidate("WR", 95);
    const streamer = candidate("RB", 80);
    const needs = new Map([
      ["RB", 3],
      ["WR", -3],
    ]);

    const picks = rankWaivers([streamer, better], needs, 0);
    expect(picks.map((pick) => pick.candidate)).toEqual([better, streamer]);
  });

  it("reports the need it used, already clamped", () => {
    const picks = rankWaivers([candidate("RB", 50)], new Map([["RB", 4]]), 0.5);
    expect(picks[0].need).toBe(NEED_CLAMP);
    expect(picks[0].multiplier).toBeCloseTo(1.5, 6);
  });

  it("drops a candidate with no projection rather than scoring them at zero", () => {
    const projected = candidate("RB", 40);
    const picks = rankWaivers(
      [projected, candidate("RB", null), candidate("K", null)],
      NO_NEEDS,
    );

    expect(picks).toHaveLength(1);
    expect(picks[0].candidate).toBe(projected);
  });

  it("treats a position it has no needs row for as average", () => {
    const unknown = candidate(null, 70);
    const picks = rankWaivers([unknown], new Map([["RB", 2]]), 1);
    expect(picks[0].multiplier).toBe(1);
    expect(picks[0].score).toBe(70);
  });

  it("breaks a tied score on the raw projection", () => {
    // 60 × 1.5 and 90 × 1.0 both score 90; the ranking falls back to §7's
    // underlying signal rather than to whichever was passed in first.
    const weighted = candidate("RB", 60);
    const raw = candidate("WR", 90);
    const needs = new Map([["RB", 1]]);

    const picks = rankWaivers([weighted, raw], needs, 0.5);
    expect(picks[0].score).toBeCloseTo(picks[1].score, 6);
    expect(picks[0].candidate).toBe(raw);
  });

  it("carries the caller's own row through the math", () => {
    type Row = WaiverCandidate & { name: string };
    const row: Row = { playerId: 99, position: "TE", rosPoints: 55, name: "Somebody" };

    const picks = rankWaivers<Row>([row], NO_NEEDS);
    expect(picks[0].candidate.name).toBe("Somebody");
  });

  it("has nothing to recommend from an empty pool", () => {
    expect(rankWaivers([], NO_NEEDS)).toEqual([]);
  });
});

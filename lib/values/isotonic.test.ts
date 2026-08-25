import { describe, expect, it } from "vitest";

import { fitIsotonic, isExtrapolated, predictIsotonic, spearman } from "./isotonic";

describe("fitIsotonic", () => {
  it("leaves an already-monotone series alone", () => {
    const fit = fitIsotonic([
      { x: 1, y: 10 },
      { x: 2, y: 20 },
      { x: 3, y: 30 },
    ]);

    expect(fit.xs).toEqual([1, 2, 3]);
    expect(fit.ys).toEqual([10, 20, 30]);
    expect(fit.samples).toBe(3);
  });

  it("pools a violating pair into their mean", () => {
    const fit = fitIsotonic([
      { x: 1, y: 10 },
      { x: 2, y: 30 },
      { x: 3, y: 20 },
      { x: 4, y: 40 },
    ]);

    expect(fit.ys).toEqual([10, 25, 40]);
  });

  it("produces a non-decreasing fit from noisy data", () => {
    const points = Array.from({ length: 60 }, (_, i) => ({
      x: i,
      y: i * i + (i % 7) * 40 - (i % 5) * 30,
    }));

    const fit = fitIsotonic(points);
    for (let i = 1; i < fit.ys.length; i += 1) {
      expect(fit.ys[i]).toBeGreaterThanOrEqual(fit.ys[i - 1]);
    }
  });

  it("pools ties on x, so equal VOR can never earn different values", () => {
    const fit = fitIsotonic([
      { x: 1, y: 10 },
      { x: 1, y: 30 },
      { x: 2, y: 40 },
    ]);

    expect(fit.xs).toEqual([1, 2]);
    expect(fit.ys).toEqual([20, 40]);
  });

  it("weights observations", () => {
    const fit = fitIsotonic([
      { x: 1, y: 10, weight: 3 },
      { x: 1, y: 30, weight: 1 },
    ]);

    expect(fit.ys).toEqual([15]);
  });

  it("survives an empty sample", () => {
    expect(fitIsotonic([])).toEqual({ xs: [], ys: [], samples: 0 });
    expect(predictIsotonic(fitIsotonic([]), 5)).toBe(0);
  });
});

describe("predictIsotonic", () => {
  const fit = fitIsotonic([
    { x: 0, y: 100 },
    { x: 10, y: 500 },
    { x: 20, y: 4000 },
  ]);

  it("interpolates between breakpoints", () => {
    expect(predictIsotonic(fit, 5)).toBeCloseTo(300, 6);
    expect(predictIsotonic(fit, 15)).toBeCloseTo(2250, 6);
  });

  it("holds flat outside the observed range rather than inventing market data", () => {
    expect(predictIsotonic(fit, -50)).toBe(100);
    expect(predictIsotonic(fit, 500)).toBe(4000);
  });

  it("is monotone across the whole range", () => {
    let previous = -Infinity;
    for (let x = -5; x <= 25; x += 0.5) {
      const y = predictIsotonic(fit, x);
      expect(y).toBeGreaterThanOrEqual(previous);
      previous = y;
    }
  });

  it("reports which side of the fit an input fell on", () => {
    expect(isExtrapolated(fit, -1)).toBe(true);
    expect(isExtrapolated(fit, 21)).toBe(true);
    expect(isExtrapolated(fit, 10)).toBe(false);
  });
});

describe("spearman", () => {
  it("is 1 for a perfectly concordant pair, whatever the shape", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [1, 4, 9, 16, 10_000];
    expect(spearman(xs, ys)).toBeCloseTo(1, 10);
  });

  it("is -1 when reversed", () => {
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("handles ties by averaging ranks", () => {
    expect(spearman([1, 1, 2, 3], [5, 5, 6, 7])).toBeCloseTo(1, 10);
  });

  it("declines to report on a sample too small to mean anything", () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

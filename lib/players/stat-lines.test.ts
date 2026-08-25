import { describe, expect, it } from "vitest";

import {
  buildSeasonLines,
  formatStat,
  projectionDelta,
  statColumnsFor,
  type StoredLine,
} from "./stat-lines";

const line = (
  week: number,
  ptsPpr: number | null,
  stats: Record<string, number> = {},
): StoredLine => ({ week, ptsPpr, stats });

describe("buildSeasonLines", () => {
  it("pairs a week's actual against its projection", () => {
    const season = buildSeasonLines({
      season: 2025,
      actuals: [line(1, 21.4, { rush_yd: 88 })],
      projections: [line(1, 17.2, { rush_yd: 72 })],
      ppr: 1,
    });

    expect(season.weeks).toEqual([
      {
        week: 1,
        actual: 21.4,
        projected: 17.2,
        actualStats: { rush_yd: 88 },
        projectedStats: { rush_yd: 72 },
      },
    ]);
  });

  it("keeps a week only one side has", () => {
    const season = buildSeasonLines({
      season: 2026,
      actuals: [],
      projections: [line(1, 17.2), line(2, 16.1)],
      ppr: 1,
    });

    expect(season.weeks.map((week) => week.week)).toEqual([1, 2]);
    expect(season.weeks.every((week) => week.actual === null)).toBe(true);
  });

  it("scores by the league's own PPR rather than the stored total", () => {
    const stats = { pts_std: 8, pts_half_ppr: 11, rec: 6 };

    const half = buildSeasonLines({
      season: 2025,
      actuals: [line(1, 14, stats)],
      projections: [],
      ppr: 0.5,
    });
    const standard = buildSeasonLines({
      season: 2025,
      actuals: [line(1, 14, stats)],
      projections: [],
      ppr: 0,
    });

    expect(half.weeks[0].actual).toBe(11);
    expect(standard.weeks[0].actual).toBe(8);
  });

  it("prefers Sleeper's own season total over a sum of the grid", () => {
    // The grid drops lines with no scoring, so summing it undercounts a
    // season that had one. The week 0 row is the authority.
    const season = buildSeasonLines({
      season: 2025,
      actuals: [line(0, 300, { gp: 16 }), line(1, 21.4), line(2, 18.6)],
      projections: [],
      ppr: 1,
    });

    expect(season.total.actual).toBe(300);
    expect(season.total.gamesPlayed).toBe(16);
    expect(season.weeks).toHaveLength(2);
  });

  it("falls back to summing the weeks when no total was pulled", () => {
    const season = buildSeasonLines({
      season: 2025,
      actuals: [line(1, 20), line(2, 10)],
      projections: [line(1, 15), line(2, 15)],
      ppr: 1,
    });

    expect(season.total.actual).toBe(30);
    expect(season.total.projected).toBe(30);
    expect(season.total.gamesPlayed).toBe(2);
  });

  it("reports the preseason honestly: projections, no actuals", () => {
    const season = buildSeasonLines({
      season: 2026,
      actuals: [],
      projections: [line(0, 288), line(1, 17.2)],
      ppr: 1,
    });

    expect(season.hasActuals).toBe(false);
    expect(season.hasProjections).toBe(true);
    expect(season.total.actual).toBeNull();
    expect(season.total.gamesPlayed).toBeNull();
  });

  it("has nothing to say about a player with no rows at all", () => {
    const season = buildSeasonLines({
      season: 2026,
      actuals: [],
      projections: [],
      ppr: 1,
    });

    expect(season).toMatchObject({
      weeks: [],
      hasActuals: false,
      hasProjections: false,
      total: { actual: null, projected: null, gamesPlayed: null },
    });
  });
});

describe("statColumnsFor", () => {
  it("gives a quarterback passing and rushing", () => {
    expect(statColumnsFor("QB").map((column) => column.key)).toEqual([
      "pass_yd",
      "pass_td",
      "pass_int",
      "rush_att",
      "rush_yd",
      "rush_td",
    ]);
  });

  it("drops targets for a back and keeps them for a receiver", () => {
    expect(statColumnsFor("RB").map((column) => column.key)).not.toContain(
      "rec_tgt",
    );
    expect(statColumnsFor("wr").map((column) => column.key)).toContain(
      "rec_tgt",
    );
  });

  it("covers the positions the market declines to price", () => {
    expect(statColumnsFor("K")).not.toHaveLength(0);
    expect(statColumnsFor("DEF")).not.toHaveLength(0);
  });

  it("returns nothing for a position it does not know", () => {
    expect(statColumnsFor(null)).toEqual([]);
    expect(statColumnsFor("LS")).toEqual([]);
  });
});

describe("formatStat", () => {
  const [passYd, passTd] = statColumnsFor("QB");

  it("rounds yards whole and touchdowns to a tenth", () => {
    expect(formatStat({ pass_yd: 284.4 }, passYd)).toBe("284");
    expect(formatStat({ pass_td: 1.8 }, passTd)).toBe("1.8");
  });

  it("shows an absent stat as absent, never as zero", () => {
    expect(formatStat({}, passYd)).toBe("—");
    expect(formatStat(null, passYd)).toBe("—");
  });
});

describe("projectionDelta", () => {
  const week = {
    week: 1,
    actualStats: null,
    projectedStats: null,
  };

  it("measures the miss as a share of the projection", () => {
    expect(projectionDelta({ ...week, actual: 21, projected: 14 })).toBeCloseTo(
      0.5,
    );
  });

  it("has no opinion when a side is missing", () => {
    expect(projectionDelta({ ...week, actual: null, projected: 14 })).toBeNull();
    expect(projectionDelta({ ...week, actual: 21, projected: null })).toBeNull();
  });

  it("refuses to divide by a zero projection", () => {
    expect(projectionDelta({ ...week, actual: 6, projected: 0 })).toBeNull();
  });
});

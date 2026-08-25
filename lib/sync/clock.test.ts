import { describe, expect, it } from "vitest";

import { playedWeeks, weeksRemainingFor } from "./clock";
import type { SyncContext } from "./plan";

function context(overrides: Partial<SyncContext> = {}): SyncContext {
  return {
    leagueKey: "461.l.123456",
    season: 2026,
    liveSeason: 2026,
    seasonType: "regular",
    isRegularSeason: true,
    currentWeek: 3,
    startWeek: 1,
    endWeek: 17,
    weeksRemaining: 15,
    numTeams: 12,
    numQbs: 1,
    ppr: 1,
    ...overrides,
  };
}

describe("weeksRemainingFor", () => {
  it("counts the current week as still ahead", () => {
    expect(
      weeksRemainingFor({
        isRegularSeason: true,
        currentWeek: 3,
        startWeek: 1,
        endWeek: 17,
      }),
    ).toBe(15);
  });

  it("gives the preseason the whole slate", () => {
    expect(
      weeksRemainingFor({
        isRegularSeason: false,
        currentWeek: null,
        startWeek: 1,
        endWeek: 17,
      }),
    ).toBe(17);
  });

  it("respects a league that ends before week 17", () => {
    expect(
      weeksRemainingFor({
        isRegularSeason: true,
        currentWeek: 10,
        startWeek: 1,
        endWeek: 14,
      }),
    ).toBe(5);
  });

  it("never returns zero — the final week is still worth something", () => {
    expect(
      weeksRemainingFor({
        isRegularSeason: true,
        currentWeek: 20,
        startWeek: 1,
        endWeek: 17,
      }),
    ).toBe(1);
  });

  it("falls back to a full season when Yahoo reports no week bounds", () => {
    expect(
      weeksRemainingFor({
        isRegularSeason: false,
        currentWeek: null,
        startWeek: null,
        endWeek: null,
      }),
    ).toBe(17);
  });
});

describe("playedWeeks", () => {
  it("asks for every week up to and including the current one", () => {
    expect(playedWeeks(context())).toEqual([1, 2, 3]);
  });

  it("asks for nothing before kickoff", () => {
    expect(
      playedWeeks(context({ isRegularSeason: false, currentWeek: null })),
    ).toEqual([]);
  });

  it("stops at the league's final week once the playoffs are over", () => {
    expect(
      playedWeeks(context({ currentWeek: 17, startWeek: 1, endWeek: 14 })),
    ).toHaveLength(14);
  });
});

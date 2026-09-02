import { describe, expect, it } from "vitest";

import { allOpenScorings, nflSyncContext } from "./global-refresh";
import { marketParamsKey } from "./market";

describe("allOpenScorings", () => {
  it("covers every board the open analyzer allowlists", () => {
    const boards = allOpenScorings();
    expect(boards).toHaveLength(24);

    const keys = new Set(boards.map((board) => marketParamsKey(board)));
    expect(keys.size).toBe(24);
  });
});

describe("nflSyncContext", () => {
  it("uses the live NFL season and full week window", () => {
    const context = nflSyncContext({
      season: 2026,
      previous_season: 2025,
      season_type: "regular",
      week: 3,
    });

    expect(context.season).toBe(2026);
    expect(context.priorSeason).toBe(2025);
    expect(context.isRegularSeason).toBe(true);
    expect(context.currentWeek).toBe(3);
    expect(context.startWeek).toBe(1);
    expect(context.endWeek).toBe(17);
    expect(context.weeksRemaining).toBe(15);
  });

  it("treats preseason as projections-only for current-season actuals", () => {
    const context = nflSyncContext({
      season: 2026,
      previous_season: 2025,
      season_type: "pre",
      week: 3,
    });

    expect(context.isRegularSeason).toBe(false);
    expect(context.currentWeek).toBeNull();
    expect(context.weeksRemaining).toBe(17);
  });
});

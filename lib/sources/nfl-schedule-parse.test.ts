import { describe, expect, it } from "vitest";

import { parseNflSchedule } from "./nfl-schedule-parse";

const game = (over: Record<string, unknown> = {}) => ({
  week: 1,
  home: "KC",
  away: "BUF",
  date: "2026-09-13",
  game_id: "202610101",
  status: "pre_game",
  ...over,
});

describe("parseNflSchedule", () => {
  it("turns one game into a row for each side", () => {
    const rows = parseNflSchedule([game()]);

    expect(rows).toEqual([
      { week: 1, team: "KC", opponent: "BUF", isHome: true, kickoff: "2026-09-13" },
      { week: 1, team: "BUF", opponent: "KC", isHome: false, kickoff: "2026-09-13" },
    ]);
  });

  it("normalizes the abbreviations the sources disagree on", () => {
    const rows = parseNflSchedule([game({ home: "LA", away: "JAC" })]);
    expect(rows.map((row) => row.team)).toEqual(["LAR", "JAX"]);
    expect(rows.map((row) => row.opponent)).toEqual(["JAX", "LAR"]);
  });

  it("drops a game nobody will play", () => {
    expect(parseNflSchedule([game({ status: "canceled" })])).toEqual([]);
    // Sleeper publishes a slate before both sides of every game are known.
    expect(parseNflSchedule([game({ away: null })])).toEqual([]);
    expect(parseNflSchedule([game({ week: 22 })])).toEqual([]);
  });

  it("keeps a game whose kickoff has not been placed", () => {
    const [row] = parseNflSchedule([game({ date: "TBD" })]);
    expect(row.kickoff).toBeNull();
  });

  it("answers an unrecognizable payload with no schedule rather than throwing", () => {
    expect(parseNflSchedule({ error: "not found" })).toEqual([]);
    expect(parseNflSchedule(null)).toEqual([]);
  });
});

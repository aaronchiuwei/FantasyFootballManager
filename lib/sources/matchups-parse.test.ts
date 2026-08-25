import { describe, expect, it } from "vitest";

import { scoreboardResponse, LEAGUE_KEY } from "./__fixtures__/yahoo";
import { normalize, isPlainObject, type Plain } from "./yahoo-json";
import { parseMatchups } from "./yahoo-parse";

function content(raw: unknown): Plain {
  const payload = normalize(raw);
  if (!isPlainObject(payload) || !isPlainObject(payload.fantasy_content)) {
    throw new Error("bad fixture");
  }
  return payload.fantasy_content;
}

describe("parseMatchups", () => {
  const matchups = parseMatchups(content(scoreboardResponse()));

  it("reads every matchup across the requested weeks", () => {
    expect(matchups).toHaveLength(4);
    expect(matchups.filter((m) => m.week === 1)).toHaveLength(2);
    expect(matchups.filter((m) => m.week === 2)).toHaveLength(2);
  });

  it("reads scores, projections and status", () => {
    const [first] = matchups;
    expect(first.pointsA).toBe(104.5);
    expect(first.pointsB).toBe(121.06);
    expect(first.projectedA).toBe(98.2);
    expect(first.projectedB).toBe(110.75);
    expect(first.status).toBe("postevent");
    expect(first.isPlayoffs).toBe(false);
  });

  it("orders the sides by team key so a re-sync rewrites the same row", () => {
    // Week 2's first matchup lists team 2 before team 1; the parse must not
    // mirror week 1's pairing of the same two teams.
    const week1 = matchups.find((m) => m.week === 1)!;
    const week2 = matchups.find((m) => m.week === 2)!;

    expect(week1.teamKeyA).toBe(`${LEAGUE_KEY}.t.1`);
    expect(week2.teamKeyA).toBe(`${LEAGUE_KEY}.t.1`);
    expect(week2.teamKeyB).toBe(`${LEAGUE_KEY}.t.2`);
  });

  it("keeps a bye as a one-sided matchup rather than dropping it", () => {
    const bye = matchups.find((m) => m.teamKeyB === null);
    expect(bye?.teamKeyA).toBe(`${LEAGUE_KEY}.t.5`);
    expect(bye?.pointsB).toBeNull();
    expect(bye?.isPlayoffs).toBe(true);
  });
});

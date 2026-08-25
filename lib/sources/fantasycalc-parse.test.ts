import { describe, expect, it } from "vitest";

import { parseFantasyCalcValues } from "./fantasycalc-parse";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    player: {
      id: 42,
      name: "Ja'Marr Chase",
      position: "WR",
      sleeperId: 7564,
      maybeTeam: "CIN",
      maybeBirthday: "2000-03-01",
      maybeDraftInfo: { year: 2021, round: 1, pick: 5 },
    },
    value: 9800,
    overallRank: 1,
    positionRank: 1,
    trend30Day: -120,
    maybeTier: 1,
    maybeAdp: 1.2,
    maybeRosterPercent: 100,
    ...overrides,
  };
}

describe("parseFantasyCalcValues", () => {
  it("shapes a value row", () => {
    expect(parseFantasyCalcValues([entry()])[0]).toEqual({
      fantasyCalcId: 42,
      name: "Ja'Marr Chase",
      position: "WR",
      sleeperId: "7564",
      nflTeam: "CIN",
      birthday: "2000-03-01",
      draftYear: 2021,
      value: 9800,
      overallRank: 1,
      positionRank: 1,
      trend30Day: -120,
      tier: 1,
      adp: 1.2,
      rosterPercent: 100,
    });
  });

  it("prefers redraftValue when the payload carries one", () => {
    expect(parseFantasyCalcValues([entry({ redraftValue: 6400 })])[0].value).toBe(
      6400,
    );
  });

  it("skips rows that do not parse instead of failing the whole pull", () => {
    expect(parseFantasyCalcValues([{ player: { id: 1 } }, entry()])).toHaveLength(
      1,
    );
  });

  it("leaves a player with no Sleeper id resolvable by name", () => {
    const parsed = parseFantasyCalcValues([
      entry({ player: { id: 9, name: "Rookie Guy", position: "RB" } }),
    ])[0];

    expect(parsed.sleeperId).toBeNull();
    expect(parsed.nflTeam).toBeNull();
  });
});

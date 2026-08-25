import { describe, expect, it } from "vitest";

import {
  SleeperStateSchema,
  hasScoring,
  parseSleeperPlayers,
  parseStatMap,
} from "./sleeper-parse";

const MASTER = {
  "4034": {
    player_id: "4034",
    full_name: "Christian McCaffrey",
    first_name: "Christian",
    last_name: "McCaffrey",
    search_full_name: "christianmccaffrey",
    position: "RB",
    team: "SF",
    age: 29,
    years_exp: 8,
    status: "Active",
    injury_status: "Questionable",
    yahoo_id: 30121,
    birth_date: "1996-06-07",
    active: true,
  },
  SF: {
    player_id: "SF",
    first_name: "San Francisco",
    last_name: "49ers",
    position: "DEF",
    team: "SF",
    active: true,
  },
  "1001": {
    player_id: "1001",
    full_name: "Long Snapper",
    position: "LS",
    team: "KC",
    active: true,
  },
  "1002": { player_id: "1002", position: "WR", team: "KC" },
};

describe("parseSleeperPlayers", () => {
  const players = parseSleeperPlayers(MASTER);

  it("keeps only fantasy-relevant, nameable players", () => {
    expect(players.map((player) => player.sleeperId).sort()).toEqual([
      "4034",
      "SF",
    ]);
  });

  it("shapes a player", () => {
    expect(players.find((p) => p.sleeperId === "4034")).toEqual({
      sleeperId: "4034",
      fullName: "Christian McCaffrey",
      searchName: "christianmccaffrey",
      position: "RB",
      nflTeam: "SF",
      age: 29,
      yearsExp: 8,
      status: "Active",
      injuryStatus: "Questionable",
      yahooId: "30121",
      birthDate: "1996-06-07",
      active: true,
    });
  });

  it("builds a search name for a defense, which Sleeper ships without one", () => {
    expect(players.find((p) => p.sleeperId === "SF")).toMatchObject({
      fullName: "San Francisco 49ers",
      searchName: "sanfrancisco49ers",
      position: "DEF",
    });
  });
});

describe("parseStatMap", () => {
  it("splits the PPR total out of the stat block", () => {
    expect(
      parseStatMap({
        "4034": { pts_ppr: 312.4, rush_yd: 1400, rec: 82 },
        "9999": { rush_yd: 12 },
      }),
    ).toEqual([
      { sleeperId: "4034", ptsPpr: 312.4, stats: { rush_yd: 1400, rec: 82 } },
      { sleeperId: "9999", ptsPpr: null, stats: { rush_yd: 12 } },
    ]);
  });

  it("skips entries that are not stat blocks", () => {
    expect(parseStatMap({ "1": null, "2": { pts_ppr: 1 } })).toHaveLength(1);
  });
});

describe("hasScoring", () => {
  const line = (stats: Record<string, number>, ptsPpr: number | null = null) => ({
    sleeperId: "4034",
    ptsPpr,
    stats,
  });

  it("keeps a line that scored, in any of the three scorings", () => {
    expect(hasScoring(line({}, 21.4))).toBe(true);
    expect(hasScoring(line({ pts_std: 14.2 }))).toBe(true);
    expect(hasScoring(line({ pts_half_ppr: 0 }))).toBe(true);
  });

  it("drops the placeholder lines a weekly payload is mostly made of", () => {
    // Sleeper lists every player in the league for every week; a bye, a
    // healthy scratch and a player it simply has nothing for all come back
    // like this, and eighteen weeks of them is a table full of nothing.
    expect(hasScoring(line({}))).toBe(false);
    expect(hasScoring(line({ adp_dd_ppr: 1000 }))).toBe(false);
  });
});

describe("SleeperStateSchema", () => {
  it("reads the season clock", () => {
    expect(
      SleeperStateSchema.parse({
        week: 3,
        season: "2026",
        season_type: "regular",
        display_week: 3,
        league_season: "2026",
      }),
    ).toMatchObject({ week: 3, season: "2026", season_type: "regular" });
  });

  it("carries the previous season, which the preseason falls back on (§12)", () => {
    expect(
      SleeperStateSchema.parse({
        week: 3,
        season: "2026",
        season_type: "pre",
        display_week: 3,
        previous_season: "2025",
      }).previous_season,
    ).toBe("2025");
  });
});

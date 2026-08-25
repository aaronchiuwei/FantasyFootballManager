import { describe, expect, it } from "vitest";

import { normalize, collection, isPlainObject } from "./yahoo-json";
import { parseDiscovery, parseLeague } from "./yahoo-parse";
import {
  counted,
  discoveryResponse,
  leagueResponse,
  LEAGUE_KEY,
} from "./__fixtures__/yahoo";

function fantasyContent(raw: unknown) {
  const normalized = normalize(raw);
  if (!isPlainObject(normalized) || !isPlainObject(normalized.fantasy_content)) {
    throw new Error("fixture is not a fantasy_content payload");
  }
  return normalized.fantasy_content;
}

describe("normalize", () => {
  it("turns counted collections into arrays", () => {
    expect(normalize(counted([{ a: "1" }, { a: "2" }]))).toEqual([
      { a: "1" },
      { a: "2" },
    ]);
  });

  it("merges fragment arrays into one object", () => {
    expect(normalize([{ team_key: "k" }, { name: "n" }])).toEqual({
      team_key: "k",
      name: "n",
    });
  });

  it("collects repeated fragment keys instead of overwriting", () => {
    expect(
      normalize([{ manager: { id: "1" } }, { manager: { id: "2" } }]),
    ).toEqual({ manager: [{ id: "1" }, { id: "2" }] });
  });

  it("flattens nested fragment arrays", () => {
    expect(normalize([[{ a: "1" }, { b: "2" }], { c: "3" }])).toEqual({
      a: "1",
      b: "2",
      c: "3",
    });
  });

  it("reads a collection whether it holds one item or many", () => {
    expect(collection({ team: { name: "solo" } }, "team")).toEqual([
      { name: "solo" },
    ]);
    expect(
      collection([{ team: { name: "a" } }, { team: { name: "b" } }], "team"),
    ).toEqual([{ name: "a" }, { name: "b" }]);
  });
});

describe("parseDiscovery", () => {
  const discovery = parseDiscovery(fantasyContent(discoveryResponse()));

  it("returns the Yahoo guid", () => {
    expect(discovery.guid).toBe("USERGUID123");
  });

  it("finds every league on the account", () => {
    expect(discovery.leagues).toHaveLength(2);
    expect(discovery.leagues.map((league) => league.leagueKey)).toContain(
      LEAGUE_KEY,
    );
  });

  it("coerces Yahoo's stringified numbers", () => {
    const work = discovery.leagues.find((l) => l.leagueKey === "461.l.999")!;
    expect(work.numTeams).toBe(10);
    expect(work.season).toBe(2026);
  });

  it("treats false as an absent logo", () => {
    const work = discovery.leagues.find((l) => l.leagueKey === "461.l.999")!;
    expect(work.logoUrl).toBeNull();
  });
});

describe("parseLeague", () => {
  const { league, teams } = parseLeague(fantasyContent(leagueResponse()));

  it("reads league identity", () => {
    expect(league.leagueKey).toBe(LEAGUE_KEY);
    expect(league.gameKey).toBe("461");
    expect(league.name).toBe("Sunday Funday Dynasty Club");
    expect(league.season).toBe(2026);
    expect(league.numTeams).toBe(12);
    expect(league.currentWeek).toBe(3);
  });

  it("reads PPR off the receptions stat modifier, not a hardcoded guess", () => {
    expect(league.ppr).toBe(0.5);
  });

  it("reads roster slots and derives numQbs", () => {
    expect(league.rosterSlots).toContainEqual({
      position: "W/R/T",
      positionType: "O",
      count: 1,
      isStarting: true,
    });
    expect(league.rosterSlots.find((s) => s.position === "BN")?.isStarting).toBe(
      false,
    );
    expect(league.numQbs).toBe(1);
  });

  it("does not flag a redraft league as dynasty", () => {
    expect(league.isDynasty).toBe(false);
  });

  it("imports every team, ordered by standings rank", () => {
    expect(teams).toHaveLength(12);
    expect(teams.map((t) => t.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(teams[0].name).toBe("Sunday Scaries");
  });

  it("merges standings records onto the team rows", () => {
    const top = teams[0];
    expect(top.wins).toBe(12);
    expect(top.losses).toBe(0);
    expect(top.pointsFor).toBeCloseTo(1500.5);
    expect(top.pointsAgainst).toBeCloseTo(1200.25);
    expect(top.playoffSeed).toBe(1);
  });

  it("identifies exactly one team as the signed-in user's", () => {
    const mine = teams.filter((t) => t.isUsersTeam);
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe("Check Down Charlie");
  });

  it("keeps roster metadata that only appears on the teams sub-resource", () => {
    const top = teams[0];
    expect(top.teamId).toBe(1);
    expect(top.faabBalance).toBe(100);
    expect(top.waiverPriority).toBe(1);
  });

  it("joins co-managers and drops hidden nicknames", () => {
    expect(teams.find((t) => t.name === "Hurts So Good")?.managerName).toBe(
      "Dana & Sam",
    );
    expect(teams.find((t) => t.name === "The Waiver Wire")?.managerName).toBeNull();
  });

  it("treats an empty logo url as absent", () => {
    expect(teams.find((t) => t.name === "Bench Warmers")?.logoUrl).toBeNull();
    expect(teams[0].logoUrl).toBe("https://s.yimg.com/logo/1.png");
  });

  it("reads superflex as numQbs 2", () => {
    const { league: sf } = parseLeague(
      fantasyContent(leagueResponse({ superflex: true })),
    );
    expect(sf.numQbs).toBe(2);
  });

  it("flags a keeper league so the app can warn instead of mis-valuing", () => {
    const { league: keeper } = parseLeague(
      fantasyContent(leagueResponse({ keeper: true })),
    );
    expect(keeper.isDynasty).toBe(true);
  });
});

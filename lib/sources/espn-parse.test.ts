import { describe, expect, it } from "vitest";

import {
  espnLeagueKey,
  espnTeamKey,
  normalizeSwid,
  parseEspnFreeAgents,
  parseEspnLeague,
  parseEspnLeagueKey,
  parseEspnMatchups,
  parseEspnRosters,
} from "./espn-parse";
import {
  LEAGUE_ID,
  MY_SWID,
  SEASON,
  freeAgentPayload,
  matchupPayload,
  rosterPayload,
  settingsPayload,
} from "./__fixtures__/espn";

const REF = { leagueId: LEAGUE_ID, season: SEASON };

describe("keys", () => {
  it("round-trips a league ref", () => {
    expect(espnLeagueKey(REF)).toBe("espn:2026:123456");
    expect(parseEspnLeagueKey(espnLeagueKey(REF))).toEqual(REF);
  });

  it("does not read a Yahoo or manual key as one of ours", () => {
    expect(parseEspnLeagueKey("461.l.123456")).toBeNull();
    expect(parseEspnLeagueKey("manual:8f1c")).toBeNull();
  });

  it("names a team under its league", () => {
    expect(espnTeamKey(REF, 7)).toBe("espn:2026:123456:t7");
  });

  it("compares SWIDs without the braces or the case", () => {
    expect(normalizeSwid("{abcd-ef}")).toBe("ABCD-EF");
    expect(normalizeSwid("ABCD-EF")).toBe(normalizeSwid("{abcd-ef}"));
    expect(normalizeSwid("")).toBeNull();
    expect(normalizeSwid(null)).toBeNull();
  });
});

describe("parseEspnLeague", () => {
  const { league, teams, knowsUsersTeam } = parseEspnLeague(
    settingsPayload(),
    REF,
    MY_SWID,
  );

  it("reads the settings the value engine is parameterised by", () => {
    expect(league).toMatchObject({
      leagueKey: "espn:2026:123456",
      name: "The Ditka Memorial",
      season: 2026,
      numTeams: 2,
      scoringType: "head",
      ppr: 1,
      // A QB slot plus an OP slot is superflex.
      numQbs: 2,
      isDynasty: false,
      currentWeek: 3,
      startWeek: 1,
      endWeek: 14,
      isFinished: false,
    });
  });

  it("names the lineup slots ESPN only numbers", () => {
    expect(league.rosterSlots).toEqual([
      { position: "QB", positionType: "O", count: 1, isStarting: true },
      { position: "RB", positionType: "O", count: 2, isStarting: true },
      { position: "WR", positionType: "O", count: 2, isStarting: true },
      { position: "TE", positionType: "O", count: 1, isStarting: true },
      { position: "OP", positionType: "O", count: 1, isStarting: true },
      { position: "D/ST", positionType: "DT", count: 1, isStarting: true },
      { position: "K", positionType: "K", count: 1, isStarting: true },
      { position: "BN", positionType: "O", count: 6, isStarting: false },
      { position: "IR", positionType: "O", count: 1, isStarting: false },
      { position: "FLEX", positionType: "O", count: 1, isStarting: true },
    ]);
  });

  it("reads a team, its record and what is left of its FAAB", () => {
    expect(teams[0]).toEqual({
      teamKey: "espn:2026:123456:t1",
      teamId: 1,
      name: "Sunday Scaries",
      managerName: "you",
      logoUrl: "https://example.test/1.png",
      isUsersTeam: true,
      wins: 2,
      losses: 1,
      ties: 0,
      pointsFor: 310.5,
      pointsAgainst: 288.25,
      rank: 2,
      playoffSeed: 2,
      waiverPriority: 5,
      // 100 budgeted, 27 spent.
      faabBalance: 73,
      numberOfMoves: 4,
      numberOfTrades: 1,
    });
  });

  it("assembles a name from the halves an older season sends", () => {
    expect(teams[1].name).toBe("Gridiron Goblins");
    expect(teams[1].isUsersTeam).toBe(false);
  });

  it("claims no team when the league was read without cookies", () => {
    const anonymous = parseEspnLeague(settingsPayload(), REF, null);

    expect(anonymous.knowsUsersTeam).toBe(false);
    expect(anonymous.teams.every((team) => !team.isUsersTeam)).toBe(true);
    expect(knowsUsersTeam).toBe(true);
  });

  it("reads a keeper league as one", () => {
    const keeper = parseEspnLeague(
      settingsPayload({
        settings: {
          ...settingsPayload().settings,
          draftSettings: { keeperCount: 2 },
        },
      }),
      REF,
      null,
    );

    expect(keeper.league.isDynasty).toBe(true);
  });

  it("unwraps the one-element array the archive answers with", () => {
    expect(parseEspnLeague([settingsPayload()], REF, null).league.name).toBe(
      "The Ditka Memorial",
    );
  });
});

describe("parseEspnRosters", () => {
  const rosters = parseEspnRosters(rosterPayload(), REF);

  it("keys each roster by the team key the import writes", () => {
    expect(rosters.map((roster) => roster.teamKey)).toEqual([
      "espn:2026:123456:t1",
      "espn:2026:123456:t2",
    ]);
  });

  it("shapes a starter", () => {
    expect(rosters[0].players[0]).toEqual({
      playerId: "3139477",
      playerKey: "espn:3139477",
      name: "Patrick Mahomes",
      position: "QB",
      positionType: "O",
      nflTeam: "KC",
      isDefense: false,
      status: null,
      injuryNote: null,
      byeWeek: null,
      imageUrl: null,
      selectedPosition: "QB",
      isStarter: true,
    });
  });

  it("reads ESPN's injury words as the codes the board renders", () => {
    expect(rosters[0].players[1]).toMatchObject({
      name: "Ja'Marr Chase",
      status: "Q",
      isStarter: true,
    });
    expect(rosters[0].players[2]).toMatchObject({
      name: "Christian McCaffrey",
      status: "IR",
      selectedPosition: "BN",
      isStarter: false,
    });
  });

  it("marks a defense as one, so §4 resolves it by team", () => {
    expect(rosters[0].players[3]).toMatchObject({
      position: "D/ST",
      positionType: "DT",
      nflTeam: "WSH",
      isDefense: true,
      selectedPosition: "D/ST",
      isStarter: true,
    });
  });

  it("counts a flex as a starting slot", () => {
    expect(rosters[1].players[0]).toMatchObject({
      selectedPosition: "FLEX",
      isStarter: true,
    });
  });
});

describe("parseEspnFreeAgents", () => {
  it("keeps only the players nobody rosters", () => {
    const players = parseEspnFreeAgents(freeAgentPayload());

    expect(players.map((player) => player.name)).toEqual(["Rome Odunze"]);
    expect(players[0]).toMatchObject({
      playerId: "4429795",
      position: "WR",
      nflTeam: "CHI",
      selectedPosition: null,
      isStarter: false,
    });
  });
});

describe("parseEspnMatchups", () => {
  it("keeps the weeks asked for and keys both sides by team key", () => {
    const matchups = parseEspnMatchups(matchupPayload(), REF, [1, 2]);

    expect(matchups).toHaveLength(2);
    expect(matchups[0]).toEqual({
      week: 1,
      teamKeyA: "espn:2026:123456:t1",
      teamKeyB: "espn:2026:123456:t2",
      pointsA: 110.5,
      pointsB: 99.25,
      projectedA: null,
      projectedB: null,
      status: "postevent",
      isPlayoffs: false,
    });
    expect(matchups[1].status).toBe("preevent");
  });

  it("reads a bye and a playoff week", () => {
    const [playoff] = parseEspnMatchups(matchupPayload(), REF, [15]);

    expect(playoff).toMatchObject({ teamKeyB: null, isPlayoffs: true });
  });

  it("returns the whole schedule when no weeks are named", () => {
    expect(parseEspnMatchups(matchupPayload(), REF)).toHaveLength(3);
  });
});

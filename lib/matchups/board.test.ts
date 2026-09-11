import { describe, expect, it } from "vitest";

import { pairings, unscheduled, type MatchupRow, type PairableTeam } from "./board";
import type { LivePlayer } from "./live";

function starter(over: Partial<LivePlayer> = {}): LivePlayer {
  return { position: "WR", points: 12, actual: null, onBye: false, ...over };
}

function team(id: string, over: Partial<PairableTeam> = {}): PairableTeam {
  return {
    id,
    isUsersTeam: false,
    rank: null,
    starters: [starter(), starter()],
    ...over,
  };
}

function row(over: Partial<MatchupRow> = {}): MatchupRow {
  return {
    week: 5,
    teamA: "a",
    teamB: "b",
    pointsA: null,
    pointsB: null,
    projectedA: null,
    projectedB: null,
    status: null,
    isPlayoffs: false,
    ...over,
  };
}

const CLOCK = { currentWeek: 5 };

describe("pairings", () => {
  it("joins a row to both rosters and scores each side", () => {
    const built = pairings(
      [row({ pointsA: 40, pointsB: 31 })],
      [team("a"), team("b")],
      CLOCK,
    );

    expect(built).toHaveLength(1);
    expect(built[0].a.live.banked).toBe(40);
    expect(built[0].b?.live.banked).toBe(31);
    expect(built[0].a.live.yetToPlay).toBe(2);
  });

  it("turns the user's team to side A whichever side the row stored it on", () => {
    const built = pairings(
      [row({ pointsA: 40, pointsB: 31 })],
      [team("a"), team("b", { isUsersTeam: true })],
      CLOCK,
    );

    expect(built[0].a.team.id).toBe("b");
    expect(built[0].a.live.banked).toBe(31);
    expect(built[0].b?.team.id).toBe("a");
    expect(built[0].involvesUser).toBe(true);
  });

  it("leaves a matchup the user is not in the way the row stored it", () => {
    const built = pairings([row()], [team("a"), team("b")], CLOCK);

    expect(built[0].a.team.id).toBe("a");
    expect(built[0].involvesUser).toBe(false);
  });

  it("reports the probability from the oriented side, not the stored one", () => {
    const rows = [row({ pointsA: 90, pointsB: 40 })];
    const neutral = pairings(rows, [team("a"), team("b")], CLOCK);
    const mine = pairings(rows, [team("a"), team("b", { isUsersTeam: true })], CLOCK);

    expect(neutral[0].winProbability).toBeGreaterThan(0.5);
    expect(mine[0].winProbability).toBeLessThan(0.5);
    expect(neutral[0].winProbability! + mine[0].winProbability!).toBeCloseTo(1, 6);
  });

  it("keeps a bye as a one-sided matchup with nothing to beat", () => {
    const built = pairings([row({ teamB: null })], [team("a")], CLOCK);

    expect(built).toHaveLength(1);
    expect(built[0].b).toBeNull();
    expect(built[0].winProbability).toBeNull();
  });

  it("drops a row whose teams the roster read did not return", () => {
    expect(pairings([row()], [team("a")], CLOCK)).toEqual([]);
    expect(pairings([row()], [team("b")], CLOCK)).toEqual([]);
  });

  it("carries the provider's own projection alongside ours", () => {
    const built = pairings(
      [row({ projectedA: 118.4, projectedB: null })],
      [team("a"), team("b")],
      CLOCK,
    );

    expect(built[0].a.providerProjected).toBe(118.4);
    expect(built[0].b?.providerProjected).toBeNull();
  });

  it("reads the phase from both sides' points, not just one", () => {
    // The opponent played the early game; this side has not kicked off.
    const built = pairings(
      [row({ status: "preevent", pointsA: 0, pointsB: 44.2 })],
      [team("a"), team("b")],
      CLOCK,
    );

    expect(built[0].phase).toBe("live");
  });

  it("calls a week nobody has started upcoming", () => {
    const built = pairings(
      [row({ status: "preevent", pointsA: 0, pointsB: 0 })],
      [team("a"), team("b")],
      CLOCK,
    );

    expect(built[0].phase).toBe("upcoming");
  });

  it("puts the user's matchup first and ranks the rest behind it", () => {
    const built = pairings(
      [
        row({ teamA: "a", teamB: "b" }),
        row({ teamA: "c", teamB: "d" }),
        row({ teamA: "e", teamB: "f" }),
      ],
      [
        team("a", { rank: 1 }),
        team("b", { rank: 8 }),
        team("c", { rank: 5 }),
        team("d", { rank: 6 }),
        team("e", { rank: 3, isUsersTeam: true }),
        team("f", { rank: 11 }),
      ],
      CLOCK,
    );

    expect(built.map((pairing) => pairing.a.team.id)).toEqual(["e", "a", "c"]);
  });

  it("sorts a pairing of unranked teams last rather than first", () => {
    const built = pairings(
      [row({ teamA: "a", teamB: "b" }), row({ teamA: "c", teamB: "d" })],
      [team("a"), team("b"), team("c", { rank: 4 }), team("d", { rank: 9 })],
      CLOCK,
    );

    expect(built.map((pairing) => pairing.a.team.id)).toEqual(["c", "a"]);
  });

  it("stops projecting once the week is final, whichever side is short of lines", () => {
    // A finished week where one side's stat lines never landed. Left alone,
    // their projections would still be owed and a 131-0 loss would read close.
    const built = pairings(
      [row({ status: "postevent", pointsA: 0, pointsB: 131.1 })],
      [team("a"), team("b", { starters: [starter({ actual: 22 })] })],
      CLOCK,
    );

    expect(built[0].phase).toBe("final");
    expect(built[0].a.live.projected).toBe(0);
    expect(built[0].a.live.yetToPlay).toBe(0);
    expect(built[0].b?.live.projected).toBe(131.1);
    expect(built[0].winProbability).toBe(0);
  });

  it("keeps projecting while the week is still being played", () => {
    const built = pairings(
      [row({ status: "midevent", pointsA: 40, pointsB: 31 })],
      [team("a"), team("b")],
      CLOCK,
    );

    expect(built[0].a.live.projected).toBe(64);
    expect(built[0].a.live.yetToPlay).toBe(2);
  });

  it("settles the user's side too, after the orientation swap", () => {
    const built = pairings(
      [row({ status: "postevent", pointsA: 131.1, pointsB: 0 })],
      [team("a"), team("b", { isUsersTeam: true })],
      CLOCK,
    );

    expect(built[0].a.team.id).toBe("b");
    expect(built[0].a.live.projected).toBe(0);
    expect(built[0].winProbability).toBe(0);
  });

  it("carries the playoff flag through", () => {
    const built = pairings([row({ isPlayoffs: true })], [team("a"), team("b")], CLOCK);
    expect(built[0].isPlayoffs).toBe(true);
  });
});

describe("unscheduled", () => {
  const roster = [team("a"), team("b"), team("c")];

  it("is empty when every team is placed", () => {
    const built = pairings(
      [row({ teamA: "a", teamB: "b" }), row({ teamA: "c", teamB: null })],
      roster,
      CLOCK,
    );

    expect(unscheduled(built, roster)).toEqual([]);
  });

  it("names the teams the week's schedule left out", () => {
    const built = pairings([row({ teamA: "a", teamB: "b" })], roster, CLOCK);

    expect(unscheduled(built, roster).map((team) => team.id)).toEqual(["c"]);
  });

  it("names every team when the week has no schedule at all", () => {
    expect(unscheduled([], roster).map((team) => team.id)).toEqual(["a", "b", "c"]);
  });
});

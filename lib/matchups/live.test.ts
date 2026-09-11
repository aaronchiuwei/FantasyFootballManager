import { describe, expect, it } from "vitest";

import {
  isGameDay,
  liveSide,
  matchupPhase,
  nflToday,
  normalCdf,
  playerSd,
  settled,
  winProbability,
  type LivePlayer,
} from "./live";

function player(over: Partial<LivePlayer> = {}): LivePlayer {
  return {
    position: "WR",
    points: 12,
    actual: null,
    onBye: false,
    ...over,
  };
}

describe("playerSd", () => {
  it("scales with the projection", () => {
    expect(playerSd("WR", 20)).toBeCloseTo(12.4, 5);
    expect(playerSd("QB", 20)).toBeCloseTo(8.4, 5);
  });

  it("spreads a defense wider than a quarterback at the same projection", () => {
    expect(playerSd("DEF", 10)).toBeGreaterThan(playerSd("QB", 10));
  });

  it("floors a small projection rather than calling it certain", () => {
    expect(playerSd("WR", 1)).toBe(1.5);
    expect(playerSd("WR", 0)).toBe(1.5);
  });

  it("gives an unknown or missing position the default spread", () => {
    expect(playerSd("P", 20)).toBeCloseTo(12, 5);
    expect(playerSd(null, 20)).toBeCloseTo(12, 5);
  });

  it("reads the position case-insensitively", () => {
    expect(playerSd("qb", 20)).toBe(playerSd("QB", 20));
  });
});

describe("liveSide", () => {
  it("splits starters into what is banked and what is still owed", () => {
    const side = liveSide(
      [
        player({ actual: 18.4 }),
        player({ actual: 6.1 }),
        player({ points: 14 }),
        player({ points: 9 }),
      ],
      null,
    );

    expect(side.played).toBe(2);
    expect(side.yetToPlay).toBe(2);
    expect(side.banked).toBeCloseTo(24.5, 5);
    expect(side.remaining).toBe(23);
    expect(side.projected).toBeCloseTo(47.5, 5);
  });

  it("prefers the provider's own total to our sum of stat lines", () => {
    const side = liveSide([player({ actual: 18.4 }), player({ points: 14 })], 21.9);

    expect(side.banked).toBe(21.9);
    expect(side.bankedIsProviders).toBe(true);
    expect(side.projected).toBeCloseTo(35.9, 5);
  });

  it("falls back to our own lines when the provider published no total", () => {
    const side = liveSide([player({ actual: 18.4 })], null);

    expect(side.banked).toBeCloseTo(18.4, 5);
    expect(side.bankedIsProviders).toBe(false);
  });

  it("keeps a provider's zero when our own lines agree nothing has been scored", () => {
    const side = liveSide([player({ points: 14 })], 0);

    expect(side.banked).toBe(0);
    expect(side.bankedIsProviders).toBe(true);
  });

  it("treats a provider's zero as stale when our lines say otherwise", () => {
    const side = liveSide([player({ actual: 18.4 }), player({ points: 14 })], 0);

    expect(side.banked).toBeCloseTo(18.4, 5);
    expect(side.bankedIsProviders).toBe(false);
  });

  it("keeps a provider's zero against stat lines that are themselves zero", () => {
    const side = liveSide([player({ actual: 0 }), player({ points: 14 })], 0);

    expect(side.banked).toBe(0);
    expect(side.bankedIsProviders).toBe(true);
  });

  it("does not count a bye among the men still to play", () => {
    const side = liveSide(
      [player({ points: 14 }), player({ points: null, onBye: true })],
      null,
    );

    expect(side.yetToPlay).toBe(1);
    expect(side.unprojected).toBe(0);
    expect(side.remaining).toBe(14);
  });

  it("counts an unprojected starter as still to play but adds nothing for him", () => {
    const side = liveSide([player({ points: 14 }), player({ points: null })], null);

    expect(side.yetToPlay).toBe(2);
    expect(side.unprojected).toBe(1);
    expect(side.remaining).toBe(14);
    // He carries no projection, so he can carry no uncertainty either.
    expect(side.sd).toBeCloseTo(playerSd("WR", 14), 5);
  });

  it("adds variance across the men still to come and stops once they are all in", () => {
    const pending = liveSide([player({ points: 14 }), player({ points: 9 })], null);
    expect(pending.sd).toBeCloseTo(
      Math.hypot(playerSd("WR", 14), playerSd("WR", 9)),
      5,
    );

    const settled = liveSide([player({ actual: 14 }), player({ actual: 9 })], null);
    expect(settled.sd).toBe(0);
  });

  it("reads an empty lineup as nothing banked and nothing owed", () => {
    const side = liveSide([], null);

    expect(side).toMatchObject({
      banked: 0,
      remaining: 0,
      projected: 0,
      played: 0,
      yetToPlay: 0,
      sd: 0,
    });
  });
});

describe("settled", () => {
  const side = liveSide(
    [player({ actual: 18.4 }), player({ points: 14 }), player({ points: null })],
    96.2,
  );

  it("keeps the league's own final score", () => {
    expect(settled(side).banked).toBe(96.2);
    expect(settled(side).projected).toBe(96.2);
  });

  it("stops owing a starter who never turned up", () => {
    expect(side.yetToPlay).toBe(2);
    expect(side.remaining).toBe(14);

    expect(settled(side).yetToPlay).toBe(0);
    expect(settled(side).remaining).toBe(0);
    expect(settled(side).unprojected).toBe(0);
  });

  it("leaves a finished week with no uncertainty in it", () => {
    expect(side.sd).toBeGreaterThan(0);
    expect(settled(side).sd).toBe(0);
  });

  it("still says how many men have a line", () => {
    expect(settled(side).played).toBe(1);
  });

  it("turns a blowout the lines never landed for into the verdict it was", () => {
    const lost = settled(liveSide([player({ points: 14 })], 0));
    const won = settled(liveSide([player({ actual: 30 })], 131.1));

    expect(winProbability(lost, won)).toBe(0);
    expect(winProbability(won, lost)).toBe(1);
  });
});

describe("normalCdf", () => {
  it("is a half at the mean and symmetric about it", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 8);
    expect(normalCdf(1.3) + normalCdf(-1.3)).toBeCloseTo(1, 7);
  });

  it("matches the table at the usual landmarks", () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normalCdf(-2.5)).toBeCloseTo(0.0062097, 6);
  });

  it("saturates rather than escaping [0, 1]", () => {
    expect(normalCdf(12)).toBeCloseTo(1, 9);
    expect(normalCdf(-12)).toBeGreaterThanOrEqual(0);
    expect(normalCdf(-12)).toBeCloseTo(0, 9);
  });
});

describe("winProbability", () => {
  const lineup = (points: number[]) =>
    liveSide(
      points.map((value) => player({ points: value })),
      null,
    );

  it("is a coin flip between identical lineups", () => {
    expect(winProbability(lineup([12, 12, 12]), lineup([12, 12, 12]))).toBeCloseTo(
      0.5,
      6,
    );
  });

  it("sums to one with the mirror matchup", () => {
    const a = lineup([18, 12, 9]);
    const b = lineup([14, 11, 10]);

    expect(winProbability(a, b) + winProbability(b, a)).toBeCloseTo(1, 6);
  });

  it("favours the side projected higher, without calling it certain", () => {
    const p = winProbability(lineup([20, 15, 12]), lineup([14, 11, 10]));

    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.95);
  });

  it("hardens the same lead as players come off the board", () => {
    const early = winProbability(
      liveSide([player({ points: 20 }), player({ points: 15 })], 40),
      liveSide([player({ points: 14 }), player({ points: 11 })], 30),
    );

    const late = winProbability(
      liveSide([player({ actual: 20 }), player({ points: 15 })], 60),
      liveSide([player({ actual: 14 }), player({ points: 11 })], 44),
    );

    expect(late).toBeGreaterThan(early);
  });

  it("resolves to a verdict once nobody is left to play", () => {
    const won = liveSide([player({ actual: 30 })], 110);
    const lost = liveSide([player({ actual: 30 })], 96);

    expect(winProbability(won, lost)).toBe(1);
    expect(winProbability(lost, won)).toBe(0);
  });

  it("leaves a finished dead heat at a half rather than picking a side", () => {
    const a = liveSide([player({ actual: 30 })], 101);
    const b = liveSide([player({ actual: 28 })], 101);

    expect(winProbability(a, b)).toBe(0.5);
  });

  it("still gives a trailing side a chance while it has men left", () => {
    // Trailing on the projected final, 102 against 115, with two men left.
    const behind = liveSide([player({ points: 18 }), player({ points: 14 })], 70);
    const ahead = liveSide([], 115);

    const p = winProbability(behind, ahead);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.5);
  });
});

describe("matchupPhase", () => {
  const base = {
    week: 5,
    currentWeek: 5,
    status: null,
    banked: 0,
    playedStarters: 0,
  };

  it("calls a week the clock has moved past final, whatever the row says", () => {
    expect(matchupPhase({ ...base, week: 4, status: "midevent" })).toBe("final");
    expect(matchupPhase({ ...base, week: 4 })).toBe("final");
  });

  it("calls a week ahead of the clock upcoming", () => {
    expect(matchupPhase({ ...base, week: 7 })).toBe("upcoming");
  });

  it("takes the provider's word for a decided week", () => {
    expect(matchupPhase({ ...base, status: "postevent" })).toBe("final");
  });

  it("takes the provider's word for one under way", () => {
    expect(matchupPhase({ ...base, status: "midevent" })).toBe("live");
  });

  it("does not call the live week live before anyone has kicked off", () => {
    expect(matchupPhase({ ...base, status: "preevent" })).toBe("upcoming");
  });

  it("reads points on the board as evidence a week has started", () => {
    // ESPN publishes no in-progress state, only whether a winner is declared.
    expect(matchupPhase({ ...base, status: "preevent", banked: 34.2 })).toBe(
      "live",
    );
  });

  it("reads a stat line as evidence even when the provider's total is still 0", () => {
    // The case that shipped broken: four men on the board with scores, and a
    // running total the provider had not got round to updating.
    expect(
      matchupPhase({ ...base, status: "preevent", banked: 0, playedStarters: 4 }),
    ).toBe("live");
  });

  it("calls everything upcoming before the season has a live week", () => {
    expect(matchupPhase({ ...base, currentWeek: null })).toBe("upcoming");
    expect(matchupPhase({ ...base, currentWeek: null, week: 1 })).toBe("upcoming");
  });
});

describe("nflToday", () => {
  it("reads the date where the NFL keeps time, not the server's", () => {
    // 01:30 UTC on Monday is still Sunday evening in New York, which is the
    // middle of the late window — and the whole point of the gate.
    const lateSunday = new Date("2026-09-14T01:30:00Z");

    expect(lateSunday.toISOString().slice(0, 10)).toBe("2026-09-14");
    expect(nflToday(lateSunday)).toBe("2026-09-13");
  });

  it("gives a plain YYYY-MM-DD", () => {
    expect(nflToday(new Date("2026-09-13T17:00:00Z"))).toBe("2026-09-13");
  });
});

describe("isGameDay", () => {
  const slate = ["2026-09-10", "2026-09-13", "2026-09-14"];

  it("is true on a day the week has football on", () => {
    expect(isGameDay(slate, "2026-09-13")).toBe(true);
    expect(isGameDay(slate, "2026-09-10")).toBe(true);
  });

  it("is false on the Friday and Saturday in between", () => {
    // The week reads as live all the way from Thursday night, which is the
    // state this exists to tell apart from football actually being played.
    expect(isGameDay(slate, "2026-09-11")).toBe(false);
    expect(isGameDay(slate, "2026-09-12")).toBe(false);
  });

  it("is false when the slate was never synced", () => {
    expect(isGameDay([], "2026-09-13")).toBe(false);
  });

  it("ignores a row with no kickoff rather than counting it", () => {
    expect(isGameDay([null, null], "2026-09-13")).toBe(false);
    expect(isGameDay([null, "2026-09-13"], "2026-09-13")).toBe(true);
  });

  it("reads a timestamp as the day it falls on", () => {
    expect(isGameDay(["2026-09-13T17:00:00Z"], "2026-09-13")).toBe(true);
  });
});

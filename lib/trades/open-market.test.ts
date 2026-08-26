import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPEN_SCORING,
  MAX_SIDE,
  parseIds,
  parseScoring,
  scoringLabel,
  searchAssets,
} from "./open-market";

describe("parseScoring", () => {
  it("takes a configuration that is on the allowlist", () => {
    expect(parseScoring({ teams: "10", ppr: "0.5", qb: "2" })).toEqual({
      numTeams: 10,
      ppr: 0.5,
      numQbs: 2,
    });
  });

  it("falls back to the default for anything that is not", () => {
    // The board an anonymous query string can name is bounded to the
    // allowlist: each unseen key costs a live FantasyCalc pull.
    expect(parseScoring({ teams: "9999", ppr: "3", qb: "7" })).toEqual(
      DEFAULT_OPEN_SCORING,
    );
  });

  it("refuses a team count FantasyCalc does not publish a board for", () => {
    // 16 is the trap: the API answers it with the 12-team board rather than
    // an error, so offering it would price a 16-team league as a 12-team one
    // with nothing on screen to say so.
    expect(parseScoring({ teams: "16" }).numTeams).toBe(
      DEFAULT_OPEN_SCORING.numTeams,
    );
  });

  it("ignores junk rather than failing on it", () => {
    expect(parseScoring({})).toEqual(DEFAULT_OPEN_SCORING);
    expect(parseScoring({ teams: "abc", ppr: "", qb: undefined })).toEqual(
      DEFAULT_OPEN_SCORING,
    );
  });

  it("reads the first value when a param is repeated", () => {
    expect(parseScoring({ teams: ["14", "8"] }).numTeams).toBe(14);
  });
});

describe("scoringLabel", () => {
  it("names the format the trade was priced in", () => {
    expect(scoringLabel({ numTeams: 12, ppr: 1, numQbs: 1 })).toBe(
      "12-team · Full PPR · 1QB",
    );
    expect(scoringLabel({ numTeams: 10, ppr: 0, numQbs: 2 })).toBe(
      "10-team · Standard · Superflex",
    );
  });
});

describe("parseIds", () => {
  it("reads a comma-separated side", () => {
    expect(parseIds("4,17,231")).toEqual([4, 17, 231]);
  });

  it("drops anything that is not a player id", () => {
    expect(parseIds("4,,-1,0,abc,1.5,9")).toEqual([4, 9]);
  });

  it("de-duplicates, so a doubled id is not a doubled player", () => {
    expect(parseIds("7,7,8")).toEqual([7, 8]);
  });

  it("bounds a side, because the link came from a stranger", () => {
    const many = Array.from({ length: 40 }, (_, i) => i + 1).join(",");
    expect(parseIds(many)).toHaveLength(MAX_SIDE);
  });

  it("is empty for a missing param", () => {
    expect(parseIds(undefined)).toEqual([]);
  });
});

const BOARD = [
  { playerId: 1, name: "Ja'Marr Chase", position: "WR" },
  { playerId: 2, name: "Tyreek Hill", position: "WR" },
  { playerId: 3, name: "A.J. Brown", position: "WR" },
  { playerId: 4, name: "Hollywood Brown", position: "WR" },
  { playerId: 5, name: "Kenneth Walker III", position: "RB" },
  { playerId: 6, name: "Brian Robinson Jr.", position: "RB" },
  { playerId: 7, name: "Chase Brown", position: "RB" },
];

describe("searchAssets", () => {
  it("refuses to search on one character", () => {
    expect(searchAssets(BOARD, "c")).toEqual([]);
    expect(searchAssets(BOARD, " ")).toEqual([]);
  });

  it("finds a player by surname", () => {
    expect(searchAssets(BOARD, "hill").map((a) => a.playerId)).toEqual([2]);
  });

  it("ignores the punctuation in a name the user did not type", () => {
    expect(searchAssets(BOARD, "aj brown").map((a) => a.playerId)).toEqual([3]);
    expect(searchAssets(BOARD, "jamarr").map((a) => a.playerId)).toEqual([1]);
  });

  it("matches a name typed without its space", () => {
    expect(searchAssets(BOARD, "ajbrown").map((a) => a.playerId)).toEqual([3]);
  });

  it("ignores a generational suffix on either side", () => {
    expect(searchAssets(BOARD, "kenneth walker").map((a) => a.playerId)).toEqual(
      [5],
    );
    expect(searchAssets(BOARD, "brian robinson jr").map((a) => a.playerId)).toEqual(
      [6],
    );
  });

  it("puts the player whose name starts with the term above the one who merely contains it", () => {
    // Board order is by value, and Ja'Marr Chase outprices Chase Brown by a
    // distance — so a plain board-order sort answers a search for "chase"
    // with the wrong man.
    expect(searchAssets(BOARD, "chase").map((a) => a.playerId)).toEqual([7, 1]);
  });

  it("falls back to board order between equally good matches", () => {
    // Three word-start matches: the better player comes first, which is the
    // tiebreak a fantasy manager expects.
    expect(searchAssets(BOARD, "brown").map((a) => a.playerId)).toEqual([
      3, 4, 7,
    ]);
  });

  it("does not offer a player who is already in the trade", () => {
    expect(
      searchAssets(BOARD, "brown", { exclude: new Set([3, 4]) }).map(
        (a) => a.playerId,
      ),
    ).toEqual([7]);
  });

  it("caps how many names it shows", () => {
    expect(searchAssets(BOARD, "r", { limit: 2 })).toEqual([]);
    expect(searchAssets(BOARD, "ll", { limit: 1 })).toHaveLength(1);
  });
});

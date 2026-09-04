import { describe, expect, it } from "vitest";

import { kindFor, teamsInMove, validateMove, type MoveItem } from "./moves";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const add = (playerId: number, to = A): MoveItem => ({
  playerId,
  fromTeamId: null,
  toTeamId: to,
});
const drop = (playerId: number, from = A): MoveItem => ({
  playerId,
  fromTeamId: from,
  toTeamId: null,
});
const swap = (playerId: number, from = A, to = B): MoveItem => ({
  playerId,
  fromTeamId: from,
  toTeamId: to,
});

describe("kindFor", () => {
  it("reads a lone pickup as an add", () => {
    expect(kindFor([add(1)])).toBe("add");
  });

  it("reads a lone cut as a drop", () => {
    expect(kindFor([drop(1)])).toBe("drop");
  });

  it("reads a claim that cut someone as add_drop", () => {
    expect(kindFor([add(1), drop(2)])).toBe("add_drop");
  });

  it("reads any two-sided leg as a trade", () => {
    expect(kindFor([swap(1)])).toBe("trade");
    expect(kindFor([swap(1), swap(2, B, A)])).toBe("trade");
  });

  it("has no name for nothing", () => {
    expect(kindFor([])).toBeNull();
  });
});

describe("validateMove", () => {
  it("accepts the four shapes a league actually produces", () => {
    expect(validateMove([add(1)])).toBeNull();
    expect(validateMove([drop(1)])).toBeNull();
    expect(validateMove([add(1), drop(2)])).toBeNull();
    expect(validateMove([swap(1), swap(2, B, A)])).toBeNull();
  });

  it("refuses an empty move", () => {
    expect(validateMove([])).toBe("Pick at least one player.");
  });

  it("refuses a leg with both ends open", () => {
    expect(
      validateMove([{ playerId: 1, fromTeamId: null, toTeamId: null }]),
    ).toContain("come from somewhere");
  });

  it("refuses a trade to the team that already has him", () => {
    expect(validateMove([swap(1, A, A)])).toContain("already has him");
  });

  it("refuses the same player twice", () => {
    expect(validateMove([add(1), drop(1)])).toContain("appears twice");
  });

  it("refuses a trade with an open leg", () => {
    expect(validateMove([swap(1), drop(2, B)])).toContain("both ends");
  });
});

describe("teamsInMove", () => {
  it("lists each team once, ignoring the open ends", () => {
    expect(teamsInMove([add(1), drop(2), swap(3)]).sort()).toEqual([A, B].sort());
  });
});

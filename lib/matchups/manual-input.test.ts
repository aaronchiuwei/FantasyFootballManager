import { describe, expect, it } from "vitest";

import { planSchedule, scheduleRows, type SchedulePair } from "./manual-input";

const TEAMS = ["a", "b", "c", "d", "e"];

function plan(pairs: SchedulePair[], teams = TEAMS) {
  return planSchedule(teams, pairs);
}

describe("planSchedule", () => {
  it("turns filled rows into matchups", () => {
    const result = plan([
      { a: "a", b: "b" },
      { a: "c", b: "d" },
    ]);

    expect(result).toEqual({
      ok: true,
      plan: [
        { teamA: "a", teamB: "b" },
        { teamA: "c", teamB: "d" },
      ],
    });
  });

  it("sorts each pairing's sides so one matchup is always one row", () => {
    const typed = plan([{ a: "d", b: "c" }]);
    const reversed = plan([{ a: "c", b: "d" }]);

    expect(typed).toEqual(reversed);
    expect(typed).toMatchObject({ plan: [{ teamA: "c", teamB: "d" }] });
  });

  it("reads a half-filled row as a bye", () => {
    expect(plan([{ a: "e", b: null }])).toEqual({
      ok: true,
      plan: [{ teamA: "e", teamB: null }],
    });

    expect(plan([{ a: null, b: "e" }])).toEqual({
      ok: true,
      plan: [{ teamA: "e", teamB: null }],
    });
  });

  it("drops an empty row rather than refusing it", () => {
    const result = plan([
      { a: "a", b: "b" },
      { a: null, b: null },
      { a: "", b: "" },
    ]);

    expect(result).toMatchObject({ plan: [{ teamA: "a", teamB: "b" }] });
  });

  it("refuses a team playing twice in one week", () => {
    const result = plan([
      { a: "a", b: "b" },
      { a: "a", b: "c" },
    ]);

    expect(result).toEqual({
      ok: false,
      error: "A team can only play once a week. Check for a duplicate.",
    });
  });

  it("refuses a team playing itself", () => {
    expect(plan([{ a: "a", b: "a" }])).toMatchObject({ ok: false });
  });

  it("refuses a team that is not in this league", () => {
    expect(plan([{ a: "a", b: "zz" }])).toEqual({
      ok: false,
      error: "That team is not in this league.",
    });
  });

  it("refuses a week with nothing in it", () => {
    expect(plan([])).toMatchObject({ ok: false });
    expect(plan([{ a: null, b: null }])).toMatchObject({ ok: false });
  });

  it("orders the matchups deterministically", () => {
    const one = plan([
      { a: "c", b: "d" },
      { a: "a", b: "b" },
    ]);
    const other = plan([
      { a: "b", b: "a" },
      { a: "d", b: "c" },
    ]);

    expect(one).toEqual(other);
  });
});

describe("scheduleRows", () => {
  it("gives an even league exactly half as many rows as teams", () => {
    expect(scheduleRows(12)).toBe(6);
    expect(scheduleRows(10)).toBe(5);
  });

  it("gives an odd league a row for the bye", () => {
    expect(scheduleRows(11)).toBe(6);
    expect(scheduleRows(5)).toBe(3);
  });

  it("offers nothing for a league with no teams", () => {
    expect(scheduleRows(0)).toBe(0);
    expect(scheduleRows(-3)).toBe(0);
  });
});

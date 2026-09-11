import { describe, expect, it } from "vitest";

import { bySlotOrder, slotKey } from "./slots";
import type { StartingSlot } from "@/lib/values/vor";

type Seat = { slot: string | null; position: string | null; name: string };

function p(name: string, position: string | null, slot: string | null): Seat {
  return { name, position, slot };
}

/** A league that puts its two flexes after the receivers, as the screenshot did. */
const SLOTS: StartingSlot[] = [
  { position: "QB", count: 1, isStarting: true },
  { position: "RB", count: 2, isStarting: true },
  { position: "WR", count: 2, isStarting: true },
  { position: "W/R/T", count: 2, isStarting: true },
  { position: "TE", count: 1, isStarting: true },
  { position: "K", count: 1, isStarting: true },
  { position: "DEF", count: 1, isStarting: true },
  { position: "BN", count: 6, isStarting: false },
];

describe("slotKey", () => {
  it("keys a flex by what it can hold, so both spellings agree", () => {
    expect(slotKey("FLEX")).toBe(slotKey("W/R/T"));
    expect(slotKey("w/r/t")).toBe(slotKey("W/R/T"));
  });

  it("does not collapse a superflex into a flex", () => {
    expect(slotKey("Q/W/R/T")).not.toBe(slotKey("W/R/T"));
  });

  it("reads a defense under either spelling", () => {
    expect(slotKey("D/ST")).toBe("DEF");
    expect(slotKey("DST")).toBe("DEF");
    expect(slotKey("DEF")).toBe("DEF");
  });

  it("leaves a named position as itself", () => {
    expect(slotKey("RB")).toBe("RB");
    expect(slotKey(" te ")).toBe("TE");
    expect(slotKey("K")).toBe("K");
  });
});

describe("bySlotOrder", () => {
  it("puts the flexes where the league lists them, not with their positions", () => {
    // Arriving in the roster's position-then-value order, which is what put a
    // flex running back among the running backs on the shipped screen.
    const arrived = [
      p("Lawrence", "QB", "QB"),
      p("Taylor", "RB", "RB"),
      p("Barkley", "RB", "RB"),
      p("Lloyd", "RB", "FLEX"),
      p("Egbuka", "WR", "WR"),
      p("Moore", "WR", "WR"),
      p("Pittman", "WR", "FLEX"),
      p("Fannin", "TE", "TE"),
      p("Dicker", "K", "K"),
      p("Jaguars", "DEF", "D/ST"),
    ];

    expect(bySlotOrder(arrived, SLOTS).map((seat) => seat.name)).toEqual([
      "Lawrence",
      "Taylor",
      "Barkley",
      "Egbuka",
      "Moore",
      "Lloyd",
      "Pittman",
      "Fannin",
      "Dicker",
      "Jaguars",
    ]);
  });

  it("follows the league's order rather than a hardcoded one", () => {
    const flexLast: StartingSlot[] = [
      { position: "QB", count: 1, isStarting: true },
      { position: "TE", count: 1, isStarting: true },
      { position: "W/R/T", count: 1, isStarting: true },
    ];

    const arrived = [p("A", "QB", "QB"), p("B", "RB", "FLEX"), p("C", "TE", "TE")];

    expect(bySlotOrder(arrived, flexLast).map((seat) => seat.name)).toEqual([
      "A",
      "C",
      "B",
    ]);
  });

  it("keeps two men in one seat in the order they arrived", () => {
    const arrived = [p("First", "RB", "RB"), p("Second", "RB", "RB")];

    expect(bySlotOrder(arrived, SLOTS).map((seat) => seat.name)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("ignores bench slots when ranking the starters", () => {
    const arrived = [p("Starter", "RB", "RB"), p("Benched", "WR", "BN")];

    // BN is not a starting slot, so the man sitting in one sorts after every
    // seat the league does list rather than into the middle of the lineup.
    expect(bySlotOrder(arrived, SLOTS).map((seat) => seat.name)).toEqual([
      "Starter",
      "Benched",
    ]);
  });

  it("sorts a seat the league does not list after every seat it does", () => {
    const arrived = [
      p("Odd", "WR", "OP"),
      p("Quarterback", "QB", "QB"),
      p("Defense", "DEF", "D/ST"),
    ];

    expect(bySlotOrder(arrived, SLOTS).map((seat) => seat.name)).toEqual([
      "Quarterback",
      "Defense",
      "Odd",
    ]);
  });

  it("orders unlisted seats among themselves by position", () => {
    const arrived = [p("Kicker", "K", "XX"), p("Back", "RB", "XX")];

    expect(bySlotOrder(arrived, []).map((seat) => seat.name)).toEqual([
      "Back",
      "Kicker",
    ]);
  });

  it("tolerates a player with no slot and no position at all", () => {
    const arrived = [p("Nobody", null, null), p("Quarterback", "QB", "QB")];

    expect(bySlotOrder(arrived, SLOTS).map((seat) => seat.name)).toEqual([
      "Quarterback",
      "Nobody",
    ]);
  });

  it("returns an empty lineup unchanged", () => {
    expect(bySlotOrder([], SLOTS)).toEqual([]);
  });
});

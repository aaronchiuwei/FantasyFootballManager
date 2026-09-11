import { describe, expect, it } from "vitest";

import { bySlotOrder, slotKey } from "./slots";

type Seat = { slot: string | null; position: string | null; name: string };

function p(name: string, position: string | null, slot: string | null): Seat {
  return { name, position, slot };
}

const order = (seats: Seat[]) => bySlotOrder(seats).map((seat) => seat.name);

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
  it("reads QB, RB, WR, TE, flex, K, DEF", () => {
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

    expect(order(arrived)).toEqual([
      "Lawrence",
      "Taylor",
      "Barkley",
      "Egbuka",
      "Moore",
      "Fannin",
      "Lloyd",
      "Pittman",
      "Dicker",
      "Jaguars",
    ]);
  });

  it("puts the tight end ahead of the flexes, not behind them", () => {
    const arrived = [p("Flexed", "RB", "W/R/T"), p("End", "TE", "TE")];
    expect(order(arrived)).toEqual(["End", "Flexed"]);
  });

  it("ignores what the league's settings happen to list first", () => {
    // `roster_slots` arrives in the provider's own order, which is a fact
    // about the payload rather than about football. Nothing here reads it.
    const arrived = [p("Kicker", "K", "K"), p("Quarterback", "QB", "QB")];
    expect(order(arrived)).toEqual(["Quarterback", "Kicker"]);
  });

  it("reads a flex before a superflex", () => {
    const arrived = [p("Super", "QB", "Q/W/R/T"), p("Flexed", "RB", "W/R/T")];
    expect(order(arrived)).toEqual(["Flexed", "Super"]);
  });

  it("keeps two men in one seat in the order they arrived", () => {
    const arrived = [p("First", "RB", "RB"), p("Second", "RB", "RB")];
    expect(order(arrived)).toEqual(["First", "Second"]);
  });

  it("reads both spellings of one seat as the same seat", () => {
    const arrived = [
      p("Written FLEX", "RB", "FLEX"),
      p("End", "TE", "TE"),
      p("Written W/R/T", "WR", "W/R/T"),
    ];

    expect(order(arrived)).toEqual(["End", "Written FLEX", "Written W/R/T"]);
  });

  it("sorts a seat it cannot name after every seat it can", () => {
    const arrived = [
      p("Odd", "WR", "OP"),
      p("Quarterback", "QB", "QB"),
      p("Defense", "DEF", "D/ST"),
    ];

    expect(order(arrived)).toEqual(["Quarterback", "Defense", "Odd"]);
  });

  it("orders unnamed seats among themselves by position", () => {
    const arrived = [p("Kicker", "K", "XX"), p("Back", "RB", "XX")];
    expect(order(arrived)).toEqual(["Back", "Kicker"]);
  });

  it("tolerates a player with no slot and no position at all", () => {
    const arrived = [p("Nobody", null, null), p("Quarterback", "QB", "QB")];
    expect(order(arrived)).toEqual(["Quarterback", "Nobody"]);
  });

  it("returns an empty lineup unchanged", () => {
    expect(bySlotOrder([])).toEqual([]);
  });
});

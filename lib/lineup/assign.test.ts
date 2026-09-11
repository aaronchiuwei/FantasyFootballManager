import { describe, expect, it } from "vitest";

import {
  bestAssignment,
  isReserveSlot,
  resolveLineup,
  seatMoves,
  seats,
  type Seatable,
} from "./assign";
import type { StartingSlot } from "@/lib/values/vor";

const SLOTS: StartingSlot[] = [
  { position: "QB", count: 1, isStarting: true },
  { position: "RB", count: 2, isStarting: true },
  { position: "WR", count: 2, isStarting: true },
  { position: "W/R/T", count: 1, isStarting: true },
  { position: "TE", count: 1, isStarting: true },
  { position: "BN", count: 6, isStarting: false },
];

let seq = 0;
function p(
  position: string,
  points: number | null,
  slot: string | null = "BN",
): Seatable & { name: string } {
  seq += 1;
  return { playerId: seq, name: `${position}${seq}`, position, points, slot };
}

describe("isReserveSlot", () => {
  it("knows the holding slots", () => {
    expect(isReserveSlot("IR")).toBe(true);
    expect(isReserveSlot("il")).toBe(true);
    expect(isReserveSlot("NA")).toBe(true);
  });

  it("does not call the bench reserve", () => {
    expect(isReserveSlot("BN")).toBe(false);
    expect(isReserveSlot("RB")).toBe(false);
    expect(isReserveSlot(null)).toBe(false);
  });
});

describe("seats", () => {
  it("lays out the league's seats in seat order, not the settings' order", () => {
    // SLOTS lists its flex before its tight end, as Yahoo's settings commonly
    // do. The board reads the way a lineup reads either way.
    expect(seats([], SLOTS).map((seat) => seat.slot)).toEqual([
      "QB",
      "RB",
      "RB",
      "WR",
      "WR",
      "TE",
      "W/R/T",
    ]);
  });

  it("gives each seat of one slot a distinct key", () => {
    const keys = seats([], SLOTS).map((seat) => seat.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("fills seats from the roster and leaves the rest empty", () => {
    const qb = p("QB", 20, "QB");
    const rb = p("RB", 14, "RB");
    const filled = seats([qb, rb, p("WR", 10, "BN")], SLOTS);

    expect(filled[0].player).toBe(qb);
    expect(filled[1].player).toBe(rb);
    expect(filled[2].player).toBeNull();
    expect(filled.filter((seat) => seat.player).length).toBe(2);
  });

  it("pairs two men in one slot off against that slot's two seats", () => {
    const first = p("RB", 14, "RB");
    const second = p("RB", 9, "RB");
    const filled = seats([first, second], SLOTS);

    expect(filled[1].player).toBe(first);
    expect(filled[2].player).toBe(second);
  });

  it("keeps the bench and the reserve out of the lineup", () => {
    const filled = seats([p("RB", 14, "BN"), p("WR", 12, "IR")], SLOTS);
    expect(filled.every((seat) => seat.player === null)).toBe(true);
  });

  it("shows a player stranded in a slot the league no longer has", () => {
    const kicker = p("K", 8, "K");
    const filled = seats([kicker], SLOTS);

    expect(filled).toHaveLength(8);
    expect(filled.at(-1)).toMatchObject({ slot: "K", player: kicker });
  });

  it("shows a man with no seat left rather than dropping him", () => {
    const filled = seats(
      [p("RB", 14, "RB"), p("RB", 12, "RB"), p("RB", 9, "RB")],
      SLOTS,
    );

    expect(filled.filter((seat) => seat.player).length).toBe(3);
  });
});

describe("bestAssignment", () => {
  it("seats the best man at each position and benches the rest", () => {
    const stud = p("RB", 22);
    const scrub = p("RB", 4);
    const qb = p("QB", 18);

    const assigned = bestAssignment([stud, scrub, qb], SLOTS);

    expect(assigned.get(qb.playerId)).toBe("QB");
    expect(assigned.get(stud.playerId)).toBe("RB");
    expect(assigned.get(scrub.playerId)).toBe("RB");
  });

  it("puts the best leftover in the flex", () => {
    const backs = [p("RB", 22), p("RB", 20), p("RB", 18)];
    const receiver = p("WR", 25);

    const assigned = bestAssignment([...backs, receiver], SLOTS);

    expect(assigned.get(backs[2].playerId)).toBe("W/R/T");
  });

  it("benches everybody a seat could not be found for", () => {
    const spare = p("QB", 3);
    const assigned = bestAssignment([p("QB", 25), spare], SLOTS);

    expect(assigned.get(spare.playerId)).toBe("BN");
  });

  it("clears a stale starter rather than leaving the lineup over-full", () => {
    // He was starting and is no longer good enough. Left alone, `is_starter`
    // would still be true and every screen that totals starters would see him.
    // The flex is filled by somebody better, so there is genuinely no seat.
    const stale = p("RB", 2, "RB");
    const better = p("RB", 21, "BN");

    const assigned = bestAssignment(
      [
        stale,
        better,
        p("RB", 19, "BN"),
        p("WR", 12, "BN"),
        p("WR", 11, "BN"),
        p("WR", 10, "BN"),
      ],
      SLOTS,
    );

    expect(assigned.get(stale.playerId)).toBe("BN");
    expect(assigned.get(better.playerId)).toBe("RB");
  });

  it("would rather fill the flex with a weak starter than leave it empty", () => {
    const weak = p("RB", 2, "RB");
    const assigned = bestAssignment(
      [weak, p("RB", 21, "BN"), p("RB", 19, "BN")],
      SLOTS,
    );

    expect(assigned.get(weak.playerId)).toBe("W/R/T");
  });

  it("leaves a man on reserve where he is", () => {
    const hurt = p("RB", 30, "IR");
    const assigned = bestAssignment([hurt, p("RB", 10)], SLOTS);

    expect(assigned.get(hurt.playerId)).toBe("IR");
  });

  it("does not seat a player nothing projects", () => {
    const unknown = p("QB", null);
    const assigned = bestAssignment([unknown], SLOTS);

    expect(assigned.get(unknown.playerId)).toBe("BN");
  });

  it("accounts for every player exactly once", () => {
    const roster = [p("QB", 20), p("RB", 14, "RB"), p("WR", 9), p("TE", 5, "IR")];
    const assigned = bestAssignment(roster, SLOTS);

    expect(assigned.size).toBe(roster.length);
  });
});

describe("seatMoves", () => {
  it("swaps when the man coming in leaves a seat the other one fits", () => {
    const flexed = p("WR", 15, "W/R/T");
    const starting = p("WR", 9, "WR");

    expect(
      seatMoves([flexed, starting], "WR", flexed.playerId, starting.playerId),
    ).toEqual([
      { playerId: flexed.playerId, slot: "WR" },
      { playerId: starting.playerId, slot: "W/R/T" },
    ]);
  });

  it("benches the displaced man when nothing is vacated", () => {
    const benched = p("WR", 15, "BN");
    const starting = p("WR", 9, "WR");

    expect(
      seatMoves([benched, starting], "WR", benched.playerId, starting.playerId),
    ).toEqual([
      { playerId: benched.playerId, slot: "WR" },
      { playerId: starting.playerId, slot: "BN" },
    ]);
  });

  it("benches the displaced man when he cannot fill what was vacated", () => {
    // A tight end coming out of the flex cannot take the quarterback's seat.
    const flexed = p("TE", 15, "W/R/T");
    const quarterback = p("QB", 9, "QB");

    expect(
      seatMoves([flexed, quarterback], "QB", flexed.playerId, quarterback.playerId),
    ).toEqual([
      { playerId: flexed.playerId, slot: "QB" },
      { playerId: quarterback.playerId, slot: "BN" },
    ]);
  });

  it("empties a seat when nobody is chosen for it", () => {
    const starting = p("WR", 9, "WR");

    expect(seatMoves([starting], "WR", null, starting.playerId)).toEqual([
      { playerId: starting.playerId, slot: "BN" },
    ]);
  });

  it("fills an empty seat without moving anybody else", () => {
    const benched = p("WR", 15, "BN");

    expect(seatMoves([benched], "WR", benched.playerId, null)).toEqual([
      { playerId: benched.playerId, slot: "WR" },
    ]);
  });

  it("does nothing when the man chosen is already the man there", () => {
    const starting = p("WR", 9, "WR");

    expect(
      seatMoves([starting], "WR", starting.playerId, starting.playerId),
    ).toEqual([{ playerId: starting.playerId, slot: "WR" }]);
  });

  it("does not swap a man into the seat he is being moved out of", () => {
    // Two RB seats, both stored as `RB`: the vacated slot and the target are
    // the same name, so there is nothing to swap into.
    const first = p("RB", 15, "RB");
    const second = p("RB", 9, "RB");

    expect(
      seatMoves([first, second], "RB", first.playerId, second.playerId),
    ).toEqual([
      { playerId: first.playerId, slot: "RB" },
      { playerId: second.playerId, slot: "BN" },
    ]);
  });

  it("ignores a player who is not on this roster", () => {
    expect(seatMoves([p("WR", 9, "WR")], "WR", 9999, null)).toEqual([]);
  });

  it("does nothing at all when neither side is named", () => {
    expect(seatMoves([p("WR", 9, "WR")], "WR", null, null)).toEqual([]);
  });
});

describe("resolveLineup", () => {
  it("solves an unset week rather than leaving it empty", () => {
    const qb = p("QB", 20);
    const resolved = resolveLineup([qb, p("QB", 4)], SLOTS, new Map());

    expect(resolved.get(qb.playerId)).toBe("QB");
  });

  it("keeps the provider's own lineup on an unset week when told to", () => {
    const seated = p("QB", 4, "QB");
    const benched = p("QB", 20, "BN");

    const resolved = resolveLineup([seated, benched], SLOTS, new Map(), "keep");

    expect(resolved.get(seated.playerId)).toBe("QB");
    expect(resolved.get(benched.playerId)).toBe("BN");
  });

  it("reads a set week as the whole week", () => {
    const seated = p("QB", 4, "BN");
    const better = p("QB", 20, "QB");

    const resolved = resolveLineup(
      [seated, better],
      SLOTS,
      new Map([[seated.playerId, "QB"]]),
    );

    expect(resolved.get(seated.playerId)).toBe("QB");
    // Not named in the week, so not in it — even though the roster still says
    // he is starting and even though he is the better player.
    expect(resolved.get(better.playerId)).toBe("BN");
  });

  it("leaves a man on reserve where he is, set or unset", () => {
    const hurt = p("RB", 30, "IR");

    expect(resolveLineup([hurt], SLOTS, new Map()).get(hurt.playerId)).toBe("IR");
    expect(
      resolveLineup([hurt, p("RB", 9)], SLOTS, new Map([[999, "RB"]])).get(
        hurt.playerId,
      ),
    ).toBe("IR");
  });

  it("accounts for every player either way", () => {
    const roster = [p("QB", 20), p("RB", 14), p("WR", 9)];

    expect(resolveLineup(roster, SLOTS, new Map()).size).toBe(3);
    expect(
      resolveLineup(roster, SLOTS, new Map([[roster[0].playerId, "QB"]])).size,
    ).toBe(3);
  });
});

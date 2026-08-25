import { describe, expect, it } from "vitest";

import type { StartingSlot } from "@/lib/values/vor";

import { bestLineup, lineupChange, slotAccepts, type LineupPlayer } from "./lineup";

function slot(position: string, count = 1, isStarting = true): StartingSlot {
  return { position, count, isStarting };
}

const STANDARD: StartingSlot[] = [
  slot("QB"),
  slot("WR", 2),
  slot("RB", 2),
  slot("TE"),
  slot("W/R/T"),
  slot("K"),
  slot("DEF"),
  slot("BN", 6, false),
];

let nextId = 1;

function player(position: string, points: number | null): LineupPlayer {
  return { playerId: nextId++, position, points };
}

describe("slotAccepts", () => {
  it("reads named and flex slots the way VOR does", () => {
    expect(slotAccepts("RB")).toEqual(["RB"]);
    expect(slotAccepts("W/R/T").sort()).toEqual(["RB", "TE", "WR"]);
    expect(slotAccepts("Q/W/R/T").sort()).toEqual(["QB", "RB", "TE", "WR"]);
  });

  it("resolves the two slots no flex has ever accepted", () => {
    expect(slotAccepts("K")).toEqual(["K"]);
    expect(slotAccepts("DEF")).toEqual(["DEF"]);
    expect(slotAccepts("D/ST")).toEqual(["DEF"]);
  });

  it("fills nothing from a bench slot", () => {
    expect(slotAccepts("BN")).toEqual([]);
    expect(slotAccepts("IR")).toEqual([]);
  });
});

describe("bestLineup", () => {
  it("fills every starting slot with the best eligible player", () => {
    const qb = player("QB", 300);
    const rb1 = player("RB", 200);
    const rb2 = player("RB", 180);
    const wr1 = player("WR", 190);
    const wr2 = player("WR", 170);
    const te = player("TE", 120);
    const k = player("K", 130);
    const def = player("DEF", 110);
    const flex = player("WR", 160);

    const lineup = bestLineup(
      [qb, rb1, rb2, wr1, wr2, te, k, def, flex],
      STANDARD,
    );

    expect(lineup.points).toBe(
      300 + 200 + 180 + 190 + 170 + 120 + 130 + 110 + 160,
    );
    expect(lineup.empty).toBe(0);
    expect(lineup.slots).toHaveLength(9);
  });

  it("does not let a flex slot poach a player a named slot needed", () => {
    // One RB and one WR against RB / WR / W-R-T. Greedy from the widest slot
    // would hand the flex the running back and leave the RB slot empty.
    const rb = player("RB", 200);
    const wr = player("WR", 100);
    const spare = player("TE", 40);

    const lineup = bestLineup(
      [rb, wr, spare],
      [slot("RB"), slot("WR"), slot("W/R/T")],
    );

    expect(lineup.points).toBe(340);
    expect(lineup.empty).toBe(0);
  });

  it("spends the flex on the best player left over", () => {
    const lineup = bestLineup(
      [player("RB", 200), player("RB", 150), player("WR", 175)],
      [slot("RB"), slot("WR"), slot("W/R/T")],
    );

    // RB 200, WR 175, flex takes RB 150 — the only one left.
    expect(lineup.points).toBe(525);
  });

  it("counts an unfillable slot rather than inventing a player for it", () => {
    const lineup = bestLineup([player("QB", 300)], STANDARD);

    expect(lineup.points).toBe(300);
    expect(lineup.empty).toBe(8);
    expect(lineup.slots.filter((entry) => entry.player === null)).toHaveLength(8);
  });

  it("leaves an unprojected player on the bench rather than starting a zero", () => {
    const lineup = bestLineup(
      [player("RB", 200), player("RB", null)],
      [slot("RB", 2)],
    );

    expect(lineup.points).toBe(200);
    expect(lineup.empty).toBe(1);
    expect(lineup.unprojected).toBe(1);
  });

  it("never starts one player twice", () => {
    const only = player("RB", 200);
    const lineup = bestLineup([only], [slot("RB"), slot("W/R/T")]);

    expect(lineup.points).toBe(200);
    expect(lineup.empty).toBe(1);
  });

  it("has nothing to start from an empty roster", () => {
    expect(bestLineup([], STANDARD).points).toBe(0);
  });

  it("starts nobody in a league with no starting slots", () => {
    expect(bestLineup([player("RB", 200)], [slot("BN", 6, false)]).points).toBe(0);
  });
});

describe("lineupChange", () => {
  const slots = [slot("RB", 2), slot("WR", 2), slot("W/R/T")];

  it("re-solves both lineups rather than diffing the two rosters", () => {
    // RB3 does not start today. Sending him away still costs points, because
    // the flex slot then falls to a much worse receiver.
    const rb1 = player("RB", 220);
    const rb2 = player("RB", 200);
    const rb3 = player("RB", 180);
    const wr1 = player("WR", 210);
    const wr2 = player("WR", 190);
    const wr3 = player("WR", 40);

    const roster = [rb1, rb2, rb3, wr1, wr2, wr3];
    const change = lineupChange(roster, { out: [rb3], in: [] }, slots);

    expect(change.before).toBe(220 + 200 + 210 + 190 + 180);
    expect(change.after).toBe(220 + 200 + 210 + 190 + 40);
    expect(change.delta).toBe(40 - 180);
  });

  it("is zero for a trade of two equally projected starters", () => {
    const out = player("RB", 200);
    const incoming = player("RB", 200);
    const roster = [player("RB", 220), out, player("WR", 210), player("WR", 190)];

    expect(lineupChange(roster, { out: [out], in: [incoming] }, slots).delta).toBe(0);
  });

  it("can be positive even when the deal sheds a body", () => {
    const out1 = player("WR", 60);
    const out2 = player("WR", 50);
    const incoming = player("WR", 240);
    const roster = [player("RB", 220), player("RB", 200), out1, out2];

    const change = lineupChange(roster, { out: [out1, out2], in: [incoming] }, slots);
    expect(change.before).toBe(220 + 200 + 60 + 50);
    expect(change.after).toBe(220 + 200 + 240);
    expect(change.delta).toBeGreaterThan(0);
    // A second WR slot and the flex have nobody left for them. The deal is
    // still an improvement, and both facts get reported.
    expect(change.empty).toBe(2);
  });

  it("counts the players it could not see rather than valuing them at zero", () => {
    const out = player("RB", 200);
    const incoming = player("RB", null);
    const roster = [player("RB", 220), out];

    const change = lineupChange(roster, { out: [out], in: [incoming] }, slots);
    expect(change.unprojected).toBe(1);
    expect(change.after).toBe(220);
  });

  it("leaves a roster it was handed untouched", () => {
    const out = player("RB", 200);
    const roster = [player("RB", 220), out];
    const before = [...roster];

    lineupChange(roster, { out: [out], in: [player("RB", 100)] }, slots);
    expect(roster).toEqual(before);
  });
});

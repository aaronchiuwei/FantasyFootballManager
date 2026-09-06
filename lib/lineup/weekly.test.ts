import { describe, expect, it } from "vitest";

import type { StartingSlot } from "@/lib/values/vor";

import {
  isOptimal,
  MIN_GAIN,
  verdicts,
  weekLineup,
  type WeekPlayer,
} from "./weekly";

function slot(position: string, count = 1, isStarting = true): StartingSlot {
  return { position, count, isStarting };
}

/** A small league: one of everything, one flex, a bench. Seven seats. */
const STANDARD: StartingSlot[] = [
  slot("QB"),
  slot("RB", 2),
  slot("WR", 2),
  slot("TE"),
  slot("W/R/T"),
  slot("BN", 6, false),
];

let nextId = 1;

function player(
  position: string,
  points: number | null,
  overrides: Partial<WeekPlayer> = {},
): WeekPlayer {
  const id = nextId++;

  return {
    playerId: id,
    name: `${position} ${id}`,
    position,
    nflTeam: "SF",
    injuryStatus: null,
    headshotUrl: null,
    slot: overrides.isStarter ? position : "BN",
    isStarter: false,
    points,
    actual: null,
    opponent: "SEA",
    isHome: true,
    onBye: false,
    ...overrides,
  };
}

function starter(position: string, points: number | null): WeekPlayer {
  return player(position, points, { isStarter: true });
}

describe("weekLineup", () => {
  it("totals what is slotted now and what the roster could put out", () => {
    const players = [
      starter("QB", 20),
      starter("RB", 12),
      starter("RB", 10),
      starter("WR", 14),
      starter("WR", 8),
      starter("TE", 6),
      starter("RB", 5),
      // On the bench, and better than the flex the manager is starting.
      player("WR", 16),
    ];

    const lineup = weekLineup(players, STANDARD);

    expect(lineup.seats).toBe(7);
    expect(lineup.current.points).toBe(75);
    expect(lineup.best.points).toBe(86);
    expect(lineup.gain).toBe(11);
  });

  it("names the swap, and the swap is worth the whole difference", () => {
    const bench = player("WR", 16);
    const flex = starter("RB", 5);

    const lineup = weekLineup(
      [
        starter("QB", 20),
        starter("RB", 12),
        starter("RB", 10),
        starter("WR", 14),
        starter("WR", 8),
        starter("TE", 6),
        flex,
        bench,
      ],
      STANDARD,
    );

    expect(lineup.moves).toHaveLength(1);
    expect(lineup.moves[0].start?.playerId).toBe(bench.playerId);
    expect(lineup.moves[0].sit?.playerId).toBe(flex.playerId);
    expect(lineup.moves[0].gain).toBe(11);
    // He is the best receiver on the roster, so the optimal lineup seats him
    // at WR and pushes the weaker one into the flex the running back vacated.
    expect(lineup.moves[0].slot).toBe("WR");
  });

  it("sums the moves to the lineup's own gain, however many there are", () => {
    const lineup = weekLineup(
      [
        starter("QB", 20),
        starter("RB", 4),
        starter("RB", 3),
        starter("WR", 14),
        starter("WR", 2),
        starter("TE", 6),
        starter("TE", 1),
        player("RB", 15),
        player("WR", 13),
      ],
      STANDARD,
    );

    const summed = lineup.moves.reduce((total, move) => total + move.gain, 0);
    expect(summed).toBeCloseTo(lineup.gain, 10);
    expect(lineup.moves.length).toBeGreaterThan(1);
  });

  it("never seats a player nothing projects, and counts him instead", () => {
    const missing = starter("WR", null);

    const lineup = weekLineup(
      [
        starter("QB", 20),
        starter("RB", 12),
        starter("RB", 10),
        starter("WR", 14),
        missing,
        starter("TE", 6),
        starter("RB", 5),
      ],
      STANDARD,
    );

    expect(lineup.current.unprojected).toBe(1);
    expect(lineup.current.points).toBe(67);
    // Nobody on the bench to promote, so the seat stays empty rather than
    // being filled by a player with no projection.
    expect(lineup.best.empty).toBe(1);
    expect(lineup.moves[0].start).toBeNull();
    expect(lineup.moves[0].sit?.playerId).toBe(missing.playerId);
  });

  it("puts the starter with no projection at the head of the sit list", () => {
    const onBye = starter("WR", null);

    const lineup = weekLineup(
      [
        starter("QB", 20),
        starter("RB", 12),
        starter("RB", 10),
        starter("WR", 14),
        onBye,
        starter("TE", 6),
        starter("RB", 5),
        player("WR", 11),
        player("WR", 9),
      ],
      STANDARD,
    );

    expect(lineup.moves[0].sit?.playerId).toBe(onBye.playerId);
  });

  it("promotes into an empty seat with nobody to sit", () => {
    const bench = player("TE", 7);

    const lineup = weekLineup(
      [starter("QB", 20), starter("RB", 12), bench],
      STANDARD,
    );

    expect(lineup.current.starters).toHaveLength(2);
    expect(lineup.current.empty).toBe(5);
    expect(lineup.moves).toHaveLength(1);
    expect(lineup.moves[0].start?.playerId).toBe(bench.playerId);
    expect(lineup.moves[0].sit).toBeNull();
    expect(lineup.moves[0].gain).toBe(7);
  });

  it("counts the starters whose team has no game this week", () => {
    const lineup = weekLineup(
      [
        starter("QB", 20),
        { ...starter("RB", null), onBye: true, opponent: null },
        player("RB", 8),
      ],
      STANDARD,
    );

    expect(lineup.current.onBye).toBe(1);
  });

  it("adds up what the lineup actually scored once the week is played", () => {
    const lineup = weekLineup(
      [
        { ...starter("QB", 20), actual: 24.5 },
        { ...starter("RB", 12), actual: 3.1 },
        { ...player("WR", 16), actual: 30 },
      ],
      STANDARD,
    );

    expect(lineup.current.actual).toBeCloseTo(27.6, 10);
  });

  it("has no actual total before a snap is played", () => {
    const lineup = weekLineup([starter("QB", 20), starter("RB", 12)], STANDARD);
    expect(lineup.current.actual).toBeNull();
  });
});

describe("isOptimal", () => {
  it("calls a rearrangement inside the noise no rearrangement at all", () => {
    const lineup = weekLineup(
      [
        starter("QB", 20),
        starter("RB", 12),
        starter("RB", 10),
        starter("WR", 14),
        starter("WR", 8),
        starter("TE", 6),
        starter("RB", 5),
        player("WR", 5 + MIN_GAIN / 2),
      ],
      STANDARD,
    );

    expect(lineup.gain).toBeGreaterThan(0);
    expect(isOptimal(lineup)).toBe(true);
    expect(verdicts(lineup).size).toBe(0);
  });

  it("marks both sides of every swap it does recommend", () => {
    const bench = player("WR", 16);
    const flex = starter("RB", 5);

    const lineup = weekLineup(
      [
        starter("QB", 20),
        starter("RB", 12),
        starter("RB", 10),
        starter("WR", 14),
        starter("WR", 8),
        starter("TE", 6),
        flex,
        bench,
      ],
      STANDARD,
    );

    const marks = verdicts(lineup);
    expect(marks.get(bench.playerId)).toBe("start");
    expect(marks.get(flex.playerId)).toBe("sit");
  });
});

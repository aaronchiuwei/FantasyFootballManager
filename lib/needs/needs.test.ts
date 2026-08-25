import { describe, expect, it } from "vitest";

import type { StartingSlot } from "@/lib/values/vor";

import {
  computeNeeds,
  needStarterCounts,
  radarRadius,
  RADAR_MIN_RADIUS,
  splitStarters,
  startingStrength,
  topNeeds,
  topSurpluses,
  zScores,
  type NeedsPlayer,
  type NeedsRoster,
} from "./needs";

function slot(position: string, count = 1, isStarting = true): StartingSlot {
  return { position, count, isStarting };
}

/** The same standard Yahoo 12-team redraft league the VOR tests use. */
const STANDARD: StartingSlot[] = [
  slot("QB"),
  slot("WR", 2),
  slot("RB", 2),
  slot("TE"),
  slot("W/R/T"),
  slot("K"),
  slot("DEF"),
  slot("BN", 6, false),
  slot("IR", 2, false),
];

let nextId = 1;

function player(position: string, points: number | null): NeedsPlayer {
  return { playerId: nextId++, position, points };
}

/** A roster of RBs only, at descending projections. */
function team(teamId: string, players: NeedsPlayer[]): NeedsRoster {
  return { teamId, players };
}

function rowFor(rows: ReturnType<typeof computeNeeds>["rows"], teamId: string, position: string) {
  const row = rows.find((entry) => entry.teamId === teamId && entry.position === position);
  if (!row) throw new Error(`no ${position} row for ${teamId}`);
  return row;
}

describe("needStarterCounts", () => {
  it("carries VOR's flex split through, and adds K and DEF", () => {
    const counts = needStarterCounts(STANDARD);

    expect(counts.RB).toBeCloseTo(2.5, 6);
    expect(counts.WR).toBeCloseTo(2.4, 6);
    expect(counts.TE).toBeCloseTo(1.1, 6);
    expect(counts.QB).toBe(1);
    expect(counts.K).toBe(1);
    expect(counts.DEF).toBe(1);
  });

  it("reads Yahoo's D/ST spelling as a defense slot", () => {
    expect(needStarterCounts([slot("D/ST")]).DEF).toBe(1);
  });

  it("counts nothing for a bench slot", () => {
    expect(needStarterCounts([slot("BN", 6, false)]).RB).toBe(0);
  });
});

describe("splitStarters", () => {
  it("counts the marginal starter fractionally, as a shared flex slot is", () => {
    // 2.5 RB: two whole, plus half of the third.
    const { strength, surplus } = splitStarters([200, 150, 100, 50], 2.5);
    expect(strength).toBeCloseTo(200 + 150 + 50, 6);
    expect(surplus).toBeCloseTo(50 + 50, 6);
  });

  it("splits into two halves of the position's total", () => {
    const points = [200, 150, 100, 50];
    const { strength, surplus } = splitStarters(points, 2.5);
    expect(strength + surplus).toBeCloseTo(500, 6);
  });

  it("gives a whole starter count no fractional tail", () => {
    expect(splitStarters([200, 150, 100], 2)).toEqual({
      strength: 350,
      surplus: 100,
    });
  });

  it("has nothing to be deep at when the roster is thinner than the slots", () => {
    expect(splitStarters([200], 2.5)).toEqual({ strength: 200, surplus: 0 });
  });

  it("counts the whole position as surplus where the league starts nobody", () => {
    expect(splitStarters([200, 100], 0)).toEqual({ strength: 0, surplus: 300 });
  });

  it("says nothing about an empty position rather than failing on it", () => {
    expect(splitStarters([], 2.5)).toEqual({ strength: 0, surplus: 0 });
  });
});

describe("zScores", () => {
  it("centres on the league mean and scales by the population spread", () => {
    // Mean 20, population sd √(200/3) ≈ 8.165.
    const [low, mid, high] = zScores([10, 20, 30]);
    expect(low).toBeCloseTo(-1.2247, 4);
    expect(mid).toBeCloseTo(0, 6);
    expect(high).toBeCloseTo(1.2247, 4);

    // Sample sd would be 10 — these are every team in the league, not a
    // sample of them, so the population form is the right one.
    expect(zScores([10, 20, 30])).not.toEqual([-1, 0, 1]);
  });

  it("calls every team average when the league has no spread at all", () => {
    expect(zScores([120, 120, 120, 120])).toEqual([0, 0, 0, 0]);
  });

  it("does not mistake floating-point dust for a spread", () => {
    // Twelve identical strengths, summed in different orders, differ in the
    // last bit. A naive divide turns that into z-scores of ±1.
    const values = [0.1 + 0.2, 0.3, 0.30000000000000004];
    expect(zScores(values)).toEqual([0, 0, 0]);
  });

  it("has nothing to say about an empty league", () => {
    expect(zScores([])).toEqual([]);
  });
});

describe("computeNeeds", () => {
  it("is §7's formula: need is the negated z of positional strength", () => {
    const rosters = [
      team("weak", [player("RB", 100), player("RB", 50)]),
      team("mid", [player("RB", 200), player("RB", 100)]),
      team("strong", [player("RB", 300), player("RB", 150)]),
    ];

    const { rows } = computeNeeds(rosters, [slot("RB", 2)]);

    expect(rowFor(rows, "weak", "RB").strength).toBe(150);
    expect(rowFor(rows, "mid", "RB").strength).toBe(300);
    expect(rowFor(rows, "strong", "RB").strength).toBe(450);

    // Mean 300, population sd ~122.47.
    expect(rowFor(rows, "mid", "RB").zScore).toBeCloseTo(0, 6);
    expect(rowFor(rows, "weak", "RB").zScore).toBeCloseTo(-1.2247, 3);
    expect(rowFor(rows, "weak", "RB").need).toBeCloseTo(1.2247, 3);
    expect(rowFor(rows, "strong", "RB").need).toBeCloseTo(-1.2247, 3);
  });

  it("gives every team a row at every position, including empty ones", () => {
    const rosters = [
      team("a", [player("RB", 200)]),
      team("b", [player("WR", 200)]),
    ];

    const { rows } = computeNeeds(rosters, STANDARD);
    expect(rows).toHaveLength(2 * 6);
  });

  it("reads an empty position as the largest need there is, not as missing data", () => {
    const rosters = [
      team("none", [player("WR", 300)]),
      team("some", [player("RB", 200)]),
      team("more", [player("RB", 250)]),
    ];

    const { rows } = computeNeeds(rosters, [slot("RB", 2), slot("WR", 2)]);
    const empty = rowFor(rows, "none", "RB");

    expect(empty.strength).toBe(0);
    expect(empty.need).toBeGreaterThan(0);
    // Nothing was unseen: a strength of 0 built out of no players is exact.
    expect(empty.confidence).toBe(1);
    expect(empty.unprojected).toBe(0);
  });

  it("finds no needs in a league where every team is identical", () => {
    const rosters = ["a", "b", "c", "d"].map((id) =>
      team(id, [player("RB", 200), player("WR", 180), player("QB", 300)]),
    );

    const { rows } = computeNeeds(rosters, STANDARD);

    for (const row of rows) {
      expect(row.zScore).toBe(0);
      expect(row.need).toBe(0);
      expect(row.surplusZ).toBe(0);
      expect(Number.isFinite(row.strength)).toBe(true);
    }
  });

  it("has no need to express at a position the league starts nobody at", () => {
    // No K slot anywhere in this league's lineup.
    const slots = [slot("QB"), slot("RB", 2), slot("WR", 2)];
    const rosters = [
      team("a", [player("K", 140), player("RB", 200)]),
      team("b", [player("K", 90), player("RB", 100)]),
    ];

    const { rows, starters } = computeNeeds(rosters, slots);
    expect(starters.K).toBe(0);

    const kickers = rows.filter((row) => row.position === "K");
    for (const row of kickers) {
      expect(row.strength).toBe(0);
      expect(row.need).toBe(0);
      // The whole position is depth when none of it starts.
      expect(row.surplus).toBeGreaterThan(0);
    }
    // ...and the two teams' kickers are still ranked against each other.
    expect(rowFor(rows, "a", "K").surplusZ).toBeGreaterThan(
      rowFor(rows, "b", "K").surplusZ,
    );
  });

  it("counts a player with no projection against confidence rather than as a zero", () => {
    const rosters = [
      team("a", [player("RB", 200), player("RB", null), player("RB", null)]),
      team("b", [player("RB", 200), player("RB", 100), player("RB", 40)]),
    ];

    const { rows, unprojected } = computeNeeds(rosters, [slot("RB", 2)]);

    expect(unprojected).toBe(2);
    expect(rowFor(rows, "a", "RB").confidence).toBeCloseTo(1 / 3, 6);
    expect(rowFor(rows, "a", "RB").unprojected).toBe(2);
    expect(rowFor(rows, "b", "RB").confidence).toBe(1);
    // The unseen players did not quietly become zeroes inside the sum.
    expect(rowFor(rows, "a", "RB").strength).toBe(200);
  });

  it("normalizes Yahoo's position spellings before bucketing", () => {
    const rosters = [
      team("a", [{ playerId: 1, position: "D/ST", points: 120 }]),
      team("b", [{ playerId: 2, position: "DEF", points: 90 }]),
    ];

    const { rows } = computeNeeds(rosters, [slot("DEF")]);
    expect(rowFor(rows, "a", "DEF").strength).toBe(120);
    expect(rowFor(rows, "b", "DEF").strength).toBe(90);
  });

  it("reads a roster whole — a bench stud counts toward strength", () => {
    // Strength measures what a team has, not what its manager slotted.
    const rosters = [
      team("a", [player("RB", 300), player("RB", 290)]),
      team("b", [player("RB", 300), player("RB", 10)]),
    ];

    const { rows } = computeNeeds(rosters, [slot("RB", 2)]);
    expect(rowFor(rows, "a", "RB").need).toBeLessThan(
      rowFor(rows, "b", "RB").need,
    );
  });

  it("survives a league of one team without dividing by its own spread", () => {
    const { rows } = computeNeeds([team("only", [player("RB", 200)])], STANDARD);
    for (const row of rows) {
      expect(row.zScore).toBe(0);
      expect(row.need).toBe(0);
    }
  });

  it("has no rows for a league with no teams", () => {
    expect(computeNeeds([], STANDARD)).toEqual({
      rows: [],
      starters: needStarterCounts(STANDARD),
      teams: 0,
      unprojected: 0,
    });
  });
});

describe("reading a needs vector back", () => {
  const rosters = [
    team("a", [
      player("QB", 320),
      player("RB", 240),
      player("RB", 180),
      player("RB", 120),
      player("WR", 90),
      player("TE", 110),
      player("K", 130),
      player("DEF", 100),
    ]),
    team("b", [
      player("QB", 260),
      player("RB", 90),
      player("WR", 250),
      player("WR", 210),
      player("WR", 150),
      player("TE", 140),
      player("K", 120),
      player("DEF", 105),
    ]),
  ];

  const { rows } = computeNeeds(rosters, STANDARD);
  const forTeam = (teamId: string) => rows.filter((row) => row.teamId === teamId);

  it("sums strength into the card's headline number", () => {
    const total = startingStrength(forTeam("a"));
    expect(total).toBeGreaterThan(0);
    expect(total).toBeCloseTo(
      forTeam("a").reduce((sum, row) => sum + row.strength, 0),
      6,
    );
  });

  it("names the weaknesses, largest first", () => {
    const needs = topNeeds(forTeam("a"));
    expect(needs[0].position).toBe("WR");
    expect(needs[0].need).toBeGreaterThan(0);
    expect(needs[0].need).toBeGreaterThanOrEqual(needs[1]?.need ?? 0);
  });

  it("names the depth, and ranks it on the comparable scale", () => {
    const surpluses = topSurpluses(forTeam("a"));
    expect(surpluses[0].position).toBe("RB");
    expect(surpluses[0].surplus).toBeGreaterThan(0);
  });

  it("claims no strengths or weaknesses it cannot support", () => {
    expect(topNeeds(forTeam("a")).every((row) => row.need > 0)).toBe(true);
    expect(topSurpluses(forTeam("a")).every((row) => row.surplus > 0)).toBe(true);
  });
});

describe("radarRadius", () => {
  it("puts an average team halfway out", () => {
    expect(radarRadius(0)).toBeCloseTo(RADAR_MIN_RADIUS + (1 - RADAR_MIN_RADIUS) / 2, 6);
  });

  it("pins at the ends rather than escaping the chart", () => {
    expect(radarRadius(9)).toBe(1);
    expect(radarRadius(-9)).toBe(RADAR_MIN_RADIUS);
  });

  it("never collapses a weak axis onto the origin", () => {
    expect(radarRadius(-2)).toBeGreaterThan(0);
  });
});

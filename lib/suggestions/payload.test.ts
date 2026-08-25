import { describe, expect, it } from "vitest";

import { analyzeTrade } from "@/lib/trades/analyze";
import type { StartingSlot } from "@/lib/values/vor";

import { searchCycles, type CycleSuggestion } from "./cycles";
import {
  buildCyclePayload,
  buildSuggestionPayload,
  CYCLE_VERSION,
  parseCyclePayload,
  parseSuggestionPayload,
  SUGGESTION_VERSION,
  type NamedSuggestionAsset,
} from "./payload";
import { buildPackages, type Suggestion, type SuggestionTeam } from "./search";

function asset(
  playerId: number,
  name: string,
  {
    value = 3000,
    points = 120,
    position = "RB",
    source = "market",
    teamId = "team-a",
  }: Partial<Omit<NamedSuggestionAsset, "playerId" | "name">> = {},
): NamedSuggestionAsset {
  return {
    playerId,
    name,
    position,
    nflTeam: "CIN",
    injuryStatus: null,
    value,
    points,
    source,
    teamId,
  };
}

const SLOTS: StartingSlot[] = [
  { position: "RB", count: 1, isStarting: true },
  { position: "WR", count: 1, isStarting: true },
  { position: "W/R/T", count: 1, isStarting: true },
];

const NAMES = {
  a: { teamId: "team-a", teamName: "Regulation Grippers" },
  b: { teamId: "team-b", teamName: "Sunday Scaries" },
};

function team(
  teamId: string,
  roster: NamedSuggestionAsset[],
): SuggestionTeam<NamedSuggestionAsset> {
  return {
    teamId,
    roster: roster.map((player) => ({ ...player, teamId })),
    surplusZ: {},
    need: {},
  };
}

/** One real result out of §10's builder, so the payload is never hand-made. */
function built(): Suggestion<NamedSuggestionAsset> {
  const mine = team("team-a", [
    asset(1, "Chase Brown", { position: "RB", value: 3100, points: 150 }),
    asset(2, "Tyjae Spears", { position: "RB", value: 1400, points: 110 }),
    asset(3, "Rome Odunze", {
      position: "WR",
      value: 1500,
      points: 100,
      source: "model",
    }),
  ]);
  const theirs = team("team-b", [
    asset(11, "Ja'Marr Chase", { position: "WR", value: 3000, points: 210 }),
  ]);

  const { suggestions } = buildPackages(
    { target: theirs.roster[0], from: theirs, to: mine },
    SLOTS,
  );

  expect(suggestions.length).toBeGreaterThan(0);
  return suggestions[0];
}

describe("freezing a suggestion", () => {
  it("carries both packages, the verdict and §9's objective", () => {
    const suggestion = built();
    const payload = buildSuggestionPayload(suggestion, NAMES);

    expect(payload).not.toBeNull();
    expect(payload?.version).toBe(SUGGESTION_VERSION);
    expect(payload?.a.teamName).toBe("Regulation Grippers");
    expect(payload?.b.assets.map((entry) => entry.name)).toEqual(["Ja'Marr Chase"]);
    expect(payload?.band).toBe(suggestion.analysis.verdict?.band);
    expect(payload?.pct).toBeCloseTo(suggestion.analysis.verdict!.pct, 12);
    expect(payload?.minGain).toBeCloseTo(suggestion.score.minGain, 12);
  });

  /** §5: a package built on modelled values is a fuzzier package, per player. */
  it("carries provenance down to the individual asset", () => {
    const suggestion = built();
    const payload = buildSuggestionPayload(suggestion, NAMES);

    const sources = payload!.a.assets.map((entry) => entry.source);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(["market", "model", "model_capped", "floor"]).toContain(source);
    }
    expect(payload?.marketShare).toBeCloseTo(suggestion.analysis.marketShare, 12);
    expect(payload?.withinNoise).toBe(suggestion.analysis.verdict?.withinNoise);
  });

  it("keeps the lineup deltas, which cannot be recovered later", () => {
    const suggestion = built();
    const payload = buildSuggestionPayload(suggestion, NAMES);

    expect(payload?.a.lineup.delta).toBeCloseTo(suggestion.lineupA.delta, 12);
    expect(payload?.b.lineup.delta).toBeCloseTo(suggestion.lineupB.delta, 12);
    expect(payload?.a.lineup.after).toBeCloseTo(
      payload!.a.lineup.before + payload!.a.lineup.delta,
      9,
    );
  });

  /** §4, once more: no verdict, no row — and never an invented band. */
  it("refuses a suggestion the analyzer would not price", () => {
    const suggestion = built();

    const blocked: Suggestion<NamedSuggestionAsset> = {
      ...suggestion,
      analysis: analyzeTrade(suggestion.a, []),
    };
    expect(buildSuggestionPayload(blocked, NAMES)).toBeNull();

    const lopsided: Suggestion<NamedSuggestionAsset> = {
      ...suggestion,
      analysis: analyzeTrade(suggestion.a, [asset(99, "Nobody", { value: 40 })]),
    };
    expect(lopsided.analysis.verdict?.band).toBe("lopsided");
    expect(buildSuggestionPayload(lopsided, NAMES)).toBeNull();
  });
});

describe("reading one back", () => {
  it("round-trips through the jsonb column", () => {
    const payload = buildSuggestionPayload(built(), NAMES);
    const stored = JSON.parse(JSON.stringify(payload)) as unknown;
    expect(parseSuggestionPayload(stored)).toEqual(payload);
  });

  it("returns null for a payload it cannot read, rather than throwing", () => {
    const payload = buildSuggestionPayload(built(), NAMES);

    expect(parseSuggestionPayload(null)).toBeNull();
    expect(parseSuggestionPayload({ version: 99 })).toBeNull();
    expect(parseSuggestionPayload({ ...payload, band: "lopsided" })).toBeNull();
    expect(parseSuggestionPayload({ ...payload, a: 3 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 9 — freezing a three-team cycle
// ---------------------------------------------------------------------------

/** One of each, so a roster can have a hole only one position fills. */
const CYCLE_SLOTS: StartingSlot[] = [
  { position: "RB", count: 1, isStarting: true },
  { position: "WR", count: 1, isStarting: true },
  { position: "TE", count: 1, isStarting: true },
];

const CYCLE_NAMES: Record<string, string> = {
  A: "Regulation Grippers",
  B: "Sunday Scaries",
  C: "Fourth And Inches",
};

/** One real result out of the cycle search, so the payload is never hand-made. */
function cycled(): CycleSuggestion<NamedSuggestionAsset> {
  // The same ring `cycles.test.ts` uses: three rosters whose surpluses and
  // holes chase each other round, so no two of them can pair off.
  const shape: [string, [string, number][]][] = [
    [
      "A",
      [
        ["RB", 200],
        ["RB", 190],
        ["WR", 205],
        ["TE", 40],
      ],
    ],
    [
      "B",
      [
        ["WR", 200],
        ["WR", 190],
        ["TE", 205],
        ["RB", 40],
      ],
    ],
    [
      "C",
      [
        ["TE", 200],
        ["TE", 190],
        ["RB", 205],
        ["WR", 40],
      ],
    ],
  ];

  const teams = shape.map(([teamId, players], index) =>
    team(
      teamId,
      players.map(([position, points], slot) =>
        asset(index * 10 + slot + 1, `${teamId} ${position}${slot}`, {
          position,
          points,
          value: 3000,
          // One modelled player, so the market share on the payload is a real
          // fraction rather than a constant 1.
          source: index === 1 && slot === 1 ? "model" : "market",
        }),
      ),
    ),
  );

  const { cycles } = searchCycles({ anchorTeamId: "A", teams }, CYCLE_SLOTS);
  expect(cycles.length).toBeGreaterThan(0);
  return cycles[0];
}

const cycleNameFor = (teamId: string) => CYCLE_NAMES[teamId] ?? null;

describe("freezing a three-team cycle", () => {
  it("carries all three ledgers in ring order", () => {
    const cycle = cycled();
    const payload = buildCyclePayload(cycle, cycleNameFor);

    expect(payload).not.toBeNull();
    expect(payload?.version).toBe(CYCLE_VERSION);
    expect(payload?.anchorTeamId).toBe("A");
    expect(payload?.legs.map((leg) => leg.teamId)).toEqual(["A", "B", "C"]);
    expect(payload?.legs.map((leg) => leg.toTeamId)).toEqual(["B", "C", "A"]);
    expect(payload?.legs.map((leg) => leg.teamName)).toEqual([
      "Regulation Grippers",
      "Sunday Scaries",
      "Fourth And Inches",
    ]);
  });

  /** §7: every participant lands inside the band on their own in-vs-out. */
  it("reports the worst leg's verdict, never an average of three", () => {
    const cycle = cycled();
    const payload = buildCyclePayload(cycle, cycleNameFor)!;

    const worst = Math.max(...payload.legs.map((leg) => leg.pct));
    expect(payload.maxPct).toBeCloseTo(worst, 12);

    for (const leg of payload.legs) {
      expect(["even", "slight"]).toContain(leg.band);
      expect(leg.pct).toBeLessThanOrEqual(payload.maxPct + 1e-12);
    }
  });

  it("keeps each manager's own lineup delta and §5's provenance", () => {
    const cycle = cycled();
    const payload = buildCyclePayload(cycle, cycleNameFor)!;

    payload.legs.forEach((leg, index) => {
      expect(leg.lineup.delta).toBeCloseTo(cycle.legs[index].lineup.delta, 12);
      expect(leg.lineup.after).toBeCloseTo(leg.lineup.before + leg.lineup.delta, 9);
      for (const entry of leg.assets) {
        expect(["market", "model", "model_capped", "floor"]).toContain(entry.source);
      }
    });

    expect(payload.minGain).toBeCloseTo(cycle.score.minGain, 12);
    expect(payload.marketShare).toBeCloseTo(cycle.score.marketShare, 12);
  });

  /** §4, at three legs instead of two: no verdict, no row, and never a band. */
  it("refuses a cycle one of whose legs the analyzer would not price", () => {
    const cycle = cycled();

    const robbed: CycleSuggestion<NamedSuggestionAsset> = {
      ...cycle,
      legs: [
        cycle.legs[0],
        {
          ...cycle.legs[1],
          analysis: analyzeTrade(cycle.legs[1].assets, [
            asset(99, "Nobody", { value: 40 }),
          ]),
        },
        cycle.legs[2],
      ],
    };

    expect(robbed.legs[1].analysis.verdict?.band).toBe("lopsided");
    expect(buildCyclePayload(robbed, cycleNameFor)).toBeNull();
  });

  it("round-trips through the jsonb column", () => {
    const payload = buildCyclePayload(cycled(), cycleNameFor);
    const stored = JSON.parse(JSON.stringify(payload)) as unknown;
    expect(parseCyclePayload(stored)).toEqual(payload);
  });

  it("returns null for a cycle payload it cannot read", () => {
    const payload = buildCyclePayload(cycled(), cycleNameFor)!;

    expect(parseCyclePayload(null)).toBeNull();
    expect(parseCyclePayload({ version: 99 })).toBeNull();
    expect(parseCyclePayload({ ...payload, band: "clear" })).toBeNull();
    // Two legs is not a cycle, and the tuple is what says so.
    expect(
      parseCyclePayload({ ...payload, legs: payload.legs.slice(0, 2) }),
    ).toBeNull();
  });
});

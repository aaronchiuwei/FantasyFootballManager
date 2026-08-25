import { describe, expect, it } from "vitest";

import { analyzeTrade } from "@/lib/trades/analyze";
import type { StartingSlot } from "@/lib/values/vor";

import {
  buildSuggestionPayload,
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

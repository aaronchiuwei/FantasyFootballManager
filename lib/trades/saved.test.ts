import { describe, expect, it } from "vitest";

import { analyzeTrade, DEFAULT_TRADE_PARAMS } from "./analyze";
import {
  buildSnapshot,
  parseSnapshot,
  SNAPSHOT_VERSION,
  type NamedAsset,
} from "./saved";

function asset(playerId: number, name: string, value: number): NamedAsset {
  return { playerId, name, value, source: "market", position: "RB" };
}

const SIDES = {
  a: { teamId: "team-a", teamName: "Regulation Grippers" },
  b: { teamId: "team-b", teamName: "Sunday Scaries" },
};

function snapshotOf(a: NamedAsset[], b: NamedAsset[]) {
  return buildSnapshot(
    analyzeTrade(a, b),
    SIDES,
    DEFAULT_TRADE_PARAMS,
    "2026-08-25T00:00:00.000Z",
  );
}

describe("building a snapshot", () => {
  it("freezes both sides, their values and the knobs in force", () => {
    const snapshot = snapshotOf(
      [asset(1, "Ja'Marr Chase", 9000)],
      [asset(2, "Bijan Robinson", 7600), asset(3, "Jaxon Smith-Njigba", 1200)],
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.version).toBe(SNAPSHOT_VERSION);
    expect(snapshot?.params).toEqual({
      alpha: DEFAULT_TRADE_PARAMS.alpha,
      beta: DEFAULT_TRADE_PARAMS.beta,
      gamma: DEFAULT_TRADE_PARAMS.gamma,
    });
    expect(snapshot?.a.teamName).toBe("Regulation Grippers");
    expect(snapshot?.b.assets.map((entry) => entry.name)).toEqual([
      "Bijan Robinson",
      "Jaxon Smith-Njigba",
    ]);
    expect(snapshot?.a.assets[0].value).toBe(9000);
  });

  /** §4 again: nothing without a verdict is allowed to be recorded as one. */
  it("refuses to snapshot a trade that has no verdict", () => {
    expect(snapshotOf([asset(1, "Ja'Marr Chase", 9000)], [])).toBeNull();

    const unvalued: NamedAsset = {
      playerId: 9,
      name: "Someone Unmatched",
      value: 1,
      source: "floor",
      position: "WR",
    };
    expect(snapshotOf([asset(1, "Ja'Marr Chase", 9000)], [unvalued])).toBeNull();
  });
});

describe("reading one back", () => {
  it("round-trips through the jsonb column", () => {
    const snapshot = snapshotOf(
      [asset(1, "Ja'Marr Chase", 9000)],
      [asset(2, "Bijan Robinson", 8600)],
    );

    const stored = JSON.parse(JSON.stringify(snapshot)) as unknown;
    expect(parseSnapshot(stored)).toEqual(snapshot);
  });

  it("returns null for a payload it cannot read, rather than throwing", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ version: 99 })).toBeNull();
    expect(parseSnapshot({ ...snapshotOf([asset(1, "A", 10)], [asset(2, "B", 10)]), a: 3 }))
      .toBeNull();
  });
});

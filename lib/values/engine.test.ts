import { describe, expect, it } from "vitest";

import {
  computeValues,
  injuryMultiplier,
  isTradeAsset,
  kdefCap,
  SEAM_PERCENTILE,
  softCap,
  type EngineConfig,
  type EnginePlayer,
} from "./engine";
import { baselineAt, replacementRanks, type StartingSlot } from "./vor";

const ROSTER_SLOTS: StartingSlot[] = [
  { position: "QB", count: 1, isStarting: true },
  { position: "WR", count: 2, isStarting: true },
  { position: "RB", count: 2, isStarting: true },
  { position: "TE", count: 1, isStarting: true },
  { position: "W/R/T", count: 1, isStarting: true },
  { position: "K", count: 1, isStarting: true },
  { position: "DEF", count: 1, isStarting: true },
  { position: "BN", count: 6, isStarting: false },
];

const CONFIG: EngineConfig = {
  numTeams: 12,
  rosterSlots: ROSTER_SLOTS,
  weeksRemaining: 17,
};

/** How many of each position the market prices, roughly as FantasyCalc does. */
const MARKET_DEPTH = { QB: 32, RB: 60, WR: 70, TE: 30 } as const;
const POOL_DEPTH = { QB: 50, RB: 100, WR: 120, TE: 50 } as const;

/** Full-season projected points at a position rank, on realistic scales. */
const PROJECTION = {
  QB: (rank: number) => Math.max(6, 340 - rank * 4),
  RB: (rank: number) => Math.max(4, 300 - rank * 2.6),
  WR: (rank: number) => Math.max(4, 300 - rank * 2.4),
  TE: (rank: number) => Math.max(3, 230 - rank * 3.2),
} as const;

function market(
  playerId: number,
  position: string,
  value: number,
  projectedPoints: number,
): EnginePlayer {
  return {
    playerId,
    position,
    injuryStatus: null,
    isRostered: true,
    projectedPoints,
    actualPoints: null,
    gamesPlayed: null,
    market: {
      value,
      overallRank: playerId,
      positionRank: playerId,
      trend30Day: null,
      tier: 1,
    },
  };
}

function model(
  playerId: number,
  position: string,
  projectedPoints: number,
): EnginePlayer {
  return {
    playerId,
    position,
    injuryStatus: null,
    isRostered: false,
    projectedPoints,
    actualPoints: null,
    gamesPlayed: null,
    market: null,
  };
}

let nextId = 1;

/**
 * The market curve, calibrated to a live board rather than guessed at.
 *
 * `MARKET_SCALE × exp(MARKET_CONVEXITY × vor)`: convex because that is the
 * shape FantasyCalc has (§6: its top 100 hold 92.3% of all value), and a
 * function of VOR because that is the premise §13 tests.
 *
 * The two constants are fitted to three measured anchors from a real 12-team
 * PPR board — QB1 at 5,220, QB12 at 1,389, QB24 at 215 — and the fixture used
 * to be far more convex than that, putting its own QB24 at 2. That was fine
 * while every guardrail was a hard clamp onto the market's bottom, because a
 * clamp does not care where the bottom is. It stopped being fine the moment
 * the guardrails started reading a percentile and a positional tier off the
 * curve: a fixture whose deep market is two orders of magnitude cheaper than
 * the real one cannot say anything useful about either.
 */
const MARKET_SCALE = 1389;
const MARKET_CONVEXITY = 0.03;

/**
 * A synthetic league whose market prices follow that curve. The baselines are
 * derived with the same exported helpers the engine uses, which is what makes
 * the resulting rank-correlation check meaningful: get the replacement ranks
 * wrong and the VOR axis stops lining up with the prices built on top of it.
 */
function buildLeague(): EnginePlayer[] {
  nextId = 1;
  const positions = ["QB", "RB", "WR", "TE"] as const;
  const ranks = replacementRanks(ROSTER_SLOTS, CONFIG.numTeams);

  const baselines = Object.fromEntries(
    positions.map((position) => [
      position,
      baselineAt(
        Array.from({ length: POOL_DEPTH[position] }, (_, i) => PROJECTION[position](i + 1)),
        ranks[position],
      ),
    ]),
  ) as Record<(typeof positions)[number], number>;

  const players: EnginePlayer[] = [];

  for (const position of positions) {
    for (let rank = 1; rank <= POOL_DEPTH[position]; rank += 1) {
      const projectedPoints = PROJECTION[position](rank);
      const vor = projectedPoints - baselines[position];
      // Deterministic jitter: a real market is noisy around the curve, and a
      // fit that only survives noiseless data has proved nothing.
      const jitter = 1 + ((rank % 7) - 3) * 0.015;

      players.push({
        playerId: nextId++,
        position,
        injuryStatus: null,
        isRostered: rank <= 13,
        projectedPoints,
        actualPoints: null,
        gamesPlayed: null,
        market:
          rank <= MARKET_DEPTH[position]
            ? {
                value: Math.max(
                  1,
                  Math.round(
                    MARKET_SCALE * Math.exp(MARKET_CONVEXITY * vor) * jitter,
                  ),
                ),
                overallRank: rank,
                positionRank: rank,
                trend30Day: rank % 3 === 0 ? -40 : 25,
                tier: Math.ceil(rank / 6),
              }
            : null,
      });
    }
  }

  for (const position of ["K", "DEF"] as const) {
    for (let rank = 1; rank <= 32; rank += 1) {
      players.push({
        playerId: nextId++,
        position,
        injuryStatus: null,
        isRostered: rank <= 12,
        // Kickers and defenses cluster tightly — the exact reason VOR flatters
        // them and §5 caps them instead of trusting the fit.
        projectedPoints: 150 - rank * 1.5,
        actualPoints: null,
        gamesPlayed: null,
        market: null,
      });
    }
  }

  return players;
}

describe("computeValues", () => {
  const players = buildLeague();
  const report = computeValues(players, CONFIG);
  const byId = new Map(report.rows.map((row) => [row.playerId, row]));

  it("values every player handed to it — the Phase 3 exit criterion", () => {
    expect(report.rows).toHaveLength(players.length);
    for (const player of players) {
      expect(byId.get(player.playerId)?.value).toBeGreaterThan(0);
    }
  });

  it("passes market values through untouched, so a verdict stays quotable", () => {
    for (const player of players) {
      if (!player.market) continue;
      const row = byId.get(player.playerId);
      expect(row?.source).toBe("market");
      expect(row?.value).toBe(player.market.value);
      expect(row?.tier).toBe(player.market.tier);
      expect(row?.trend30d).toBe(player.market.trend30Day);
    }
  });

  it("keeps no Tier B player above the market's own bottom decile (§13)", () => {
    expect(report.seamViolations).toBe(0);

    const seams = new Map<string, number>();
    for (const position of ["QB", "RB", "WR", "TE"]) {
      const prices = players
        .filter((player) => player.market && player.position === position)
        .map((player) => player.market!.value)
        .sort((a, b) => a - b);

      seams.set(
        position,
        prices[Math.ceil(SEAM_PERCENTILE * prices.length) - 1],
      );
    }

    for (const row of report.rows) {
      if (row.source !== "model" || !row.position) continue;
      const seam = seams.get(row.position);
      if (seam === undefined) continue;
      expect(row.value).toBeLessThanOrEqual(seam);
    }
  });

  it("does not let one stale market price pin the whole modelled tier", () => {
    // The regression this replaced: the seam was the single cheapest market
    // price at the position, so a fading veteran priced at 14 flattened every
    // unpriced running back onto 14 apiece.
    const modelled = report.rows.filter(
      (row) => row.source === "model" && row.position === "RB",
    );

    expect(modelled.length).toBeGreaterThan(20);
    expect(new Set(modelled.map((row) => row.value)).size).toBeGreaterThan(5);
  });

  it("holds kickers and defenses under the QB2/TE2 tier and marks them", () => {
    const cap = kdefCap(players, CONFIG.numTeams);
    expect(report.kdefCap).toBe(cap);

    // The tier is the 2 x numTeams-th priced player at QB and at TE, averaged.
    const anchorAt = (position: string) => {
      const priced = players
        .filter((player) => player.market && player.position === position)
        .map((player) => player.market!.value)
        .sort((a, b) => b - a);
      return priced[2 * CONFIG.numTeams - 1];
    };
    expect(cap).toBe(Math.round((anchorAt("QB") + anchorAt("TE")) / 2));

    const kdef = report.rows.filter(
      (row) => row.position === "K" || row.position === "DEF",
    );

    expect(kdef).not.toHaveLength(0);
    for (const row of kdef) {
      expect(row.source).toBe("model_capped");
      expect(row.value).toBeLessThanOrEqual(cap);
      // The raw fit rates a kicker like a starting quarterback; the whole
      // point of the ceiling is that it does not survive contact with the board.
      expect(row.baseValue).toBeGreaterThan(row.value);
    }
  });

  it("still ranks kickers and defenses against each other under that ceiling", () => {
    // The regression this replaced: a hard `min` put all 46 kickers on the
    // ceiling, so the best kicker in football and a bye-week streamer carried
    // the same number.
    for (const position of ["K", "DEF"]) {
      const rows = report.rows
        .filter((row) => row.position === position)
        .sort((a, b) => (b.vor ?? 0) - (a.vor ?? 0));

      expect(new Set(rows.map((row) => row.value)).size).toBeGreaterThan(4);
      expect(rows[0].value).toBeGreaterThan(rows[rows.length - 1].value);

      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i].value).toBeLessThanOrEqual(rows[i - 1].value);
      }
    }
  });

  it("gives a below-replacement kicker no trade value at all", () => {
    // Replacement at K and DEF is the median of the position, so half the pool
    // is at or under it and lands on the floor. A streamer is not an asset.
    const kickers = report.rows.filter((row) => row.position === "K");
    const belowMedian = kickers.filter((row) => (row.vor ?? 0) <= 0);

    expect(belowMedian).not.toHaveLength(0);
    for (const row of belowMedian) expect(row.value).toBe(1);
  });

  it("never lets a better projection earn a lower model value", () => {
    const wrs = report.rows
      .filter((row) => row.position === "WR" && row.source === "model")
      .sort((a, b) => (b.vor ?? 0) - (a.vor ?? 0));

    for (let i = 1; i < wrs.length; i += 1) {
      expect(wrs[i].value).toBeLessThanOrEqual(wrs[i - 1].value);
      // The clamp flattens most of the tier onto the market's floor, so the
      // ordering has to survive the ties as well as the values.
      expect(wrs[i].overallRank).toBeGreaterThan(wrs[i - 1].overallRank);
    }
  });

  it("ranks overall densely and by position within that", () => {
    report.rows.forEach((row, index) => {
      expect(row.overallRank).toBe(index + 1);
    });

    const seen = new Map<string, number>();
    for (const row of report.rows) {
      const position = row.position ?? "UNK";
      const expected = (seen.get(position) ?? 0) + 1;
      seen.set(position, expected);
      expect(row.positionRank).toBe(expected);
    }
  });

  it("reports the fit's agreement with the market for the §13 check", () => {
    expect(report.overlap).toBeGreaterThan(150);
    expect(report.rankCorrelation).not.toBeNull();
    expect(report.rankCorrelation as number).toBeGreaterThan(0.98);
  });

  it("counts every row against exactly one source", () => {
    const total = Object.values(report.bySource).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(report.rows.length);
    expect(report.bySource.market).toBe(
      players.filter((player) => player.market).length,
    );
  });
});

describe("guardrails at the edges", () => {
  it("gives an unprojected rostered player a floor value, never a zero", () => {
    const report = computeValues(
      [
        ...buildLeague(),
        {
          playerId: 99_999,
          position: "RB",
          injuryStatus: null,
          isRostered: true,
          projectedPoints: null,
          actualPoints: null,
          gamesPlayed: null,
          market: null,
        },
      ],
      CONFIG,
    );

    const row = report.rows.find((entry) => entry.playerId === 99_999);
    expect(row?.source).toBe("floor");
    expect(row?.value).toBe(1);
    expect(row?.confidence).toBeLessThan(0.2);
  });

  it("discounts an injured model player but leaves the market's price alone", () => {
    // A focused league rather than the big fixture: the seam clamp pins the
    // model tier to the lowest market price in the band, so headroom under it
    // is the only place an injury discount is observable at all.
    const base: EnginePlayer[] = [
      market(1, "WR", 5000, 260),
      market(2, "WR", 900, 180),
      model(3, "WR", 150),
      model(4, "WR", 120),
    ];

    const injure = (id: number) =>
      base.map((player) =>
        player.playerId === id ? { ...player, injuryStatus: "IR" } : player,
      );

    const value = (players: EnginePlayer[], id: number) =>
      computeValues(players, CONFIG).rows.find((row) => row.playerId === id)!.value;

    expect(value(base, 3)).toBeGreaterThan(1);
    expect(value(injure(3), 3)).toBeLessThan(value(base, 3));
    expect(value(injure(1), 1)).toBe(value(base, 1));
  });

  it("falls back to a nominal K/DEF ceiling when nothing is market-priced", () => {
    const report = computeValues(
      [
        {
          playerId: 1,
          position: "K",
          injuryStatus: null,
          isRostered: true,
          projectedPoints: 140,
          actualPoints: null,
          gamesPlayed: null,
          market: null,
        },
      ],
      CONFIG,
    );

    expect(report.kdefCap).toBe(200);
    expect(report.rows[0].source).toBe("model_capped");
    expect(report.rows[0].value).toBeLessThanOrEqual(200);
  });

  it("holds a league with no market data at all together", () => {
    const report = computeValues(
      [
        {
          playerId: 1,
          position: "RB",
          injuryStatus: null,
          isRostered: true,
          projectedPoints: 260,
          actualPoints: null,
          gamesPlayed: null,
          market: null,
        },
      ],
      CONFIG,
    );

    expect(report.overlap).toBe(0);
    expect(report.rankCorrelation).toBeNull();
    expect(report.rows[0].value).toBeGreaterThan(0);
  });
});

describe("softCap", () => {
  it("passes a value well under the ceiling through untouched", () => {
    expect(softCap(10, 100)).toBe(10);
    expect(softCap(49, 100)).toBe(49);
  });

  it("never reaches the ceiling, however large the input", () => {
    for (const value of [100, 1_000, 100_000, 1e9]) {
      expect(softCap(value, 100)).toBeLessThan(100);
    }
  });

  it("stays strictly increasing across the whole range", () => {
    // The property the entire fix turns on. `Math.min` fails it the instant
    // two inputs sit above the ceiling, which is how 46 kickers came out as
    // one number.
    let previous = -Infinity;
    for (let value = 0; value <= 5000; value += 7) {
      const capped = softCap(value, 163);
      expect(capped).toBeGreaterThan(previous);
      previous = capped;
    }
  });

  it("bends with no kink at the knee", () => {
    const knee = 163 * 0.5;
    expect(softCap(knee, 163)).toBeCloseTo(knee, 10);
    // Slope 1 on both sides: the identity below, the curve's own derivative
    // above.
    const below = (softCap(knee, 163) - softCap(knee - 0.001, 163)) / 0.001;
    const above = (softCap(knee + 0.001, 163) - softCap(knee, 163)) / 0.001;
    expect(above).toBeCloseTo(below, 3);
  });

  it("leaves a value alone when there is no ceiling to apply", () => {
    expect(softCap(42, 0)).toBe(42);
    expect(softCap(42, Number.NaN)).toBe(42);
  });
});

describe("the seam against one stale price", () => {
  /**
   * The regression, in miniature. A position priced sanely except for a single
   * veteran who has fallen off a cliff: under a `min` seam his price became the
   * ceiling for every unpriced running back in football.
   */
  function board(): EnginePlayer[] {
    const players: EnginePlayer[] = [];
    let id = 1;

    for (let rank = 1; rank <= 40; rank += 1) {
      players.push(
        market(
          id++,
          "RB",
          rank === 40 ? 3 : Math.round(4000 / rank),
          300 - rank * 4,
        ),
      );
    }
    for (let rank = 41; rank <= 70; rank += 1) {
      players.push(model(id++, "RB", 300 - rank * 4));
    }
    // A second position, priced deep enough that the shared VOR->value fit has
    // a shape down where the unpriced running backs live. Without it they all
    // sit below the fit's lowest anchor, `predictIsotonic` clamps them to its
    // bottom block, and the tier is flat for a reason that has nothing to do
    // with the seam.
    for (let rank = 1; rank <= 60; rank += 1) {
      players.push(market(id++, "WR", Math.round(3600 / rank), 290 - rank * 3));
    }

    return players;
  }

  it("does not flatten the modelled tier onto the one cheap price", () => {
    const report = computeValues(board(), CONFIG);
    const modelled = report.rows.filter(
      (row) => row.source === "model" && row.position === "RB",
    );

    expect(modelled.length).toBeGreaterThan(20);
    expect(new Set(modelled.map((row) => row.value)).size).toBeGreaterThan(5);

    // And the ordering is the projection's, not an accident of the clamp.
    const byVor = [...modelled].sort((a, b) => (b.vor ?? 0) - (a.vor ?? 0));
    for (let i = 1; i < byVor.length; i += 1) {
      expect(byVor[i].value).toBeLessThanOrEqual(byVor[i - 1].value);
    }
  });
});

describe("position policy", () => {
  it("treats kickers and defenses as lineup pieces, not trade assets (§3)", () => {
    expect(isTradeAsset("RB")).toBe(true);
    expect(isTradeAsset("K")).toBe(false);
    expect(isTradeAsset("DEF")).toBe(false);
    expect(isTradeAsset("D/ST")).toBe(false);
    expect(isTradeAsset(null)).toBe(false);
  });

  it("reads injury status the way Sleeper writes it", () => {
    expect(injuryMultiplier(null)).toBe(1);
    expect(injuryMultiplier("Questionable")).toBeCloseTo(0.95, 6);
    expect(injuryMultiplier("I.R.")).toBeCloseTo(0.15, 6);
    expect(injuryMultiplier("Something new")).toBe(1);
  });
});

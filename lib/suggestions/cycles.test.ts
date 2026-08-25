import { describe, expect, it } from "vitest";

import { analyzeTrade, DEFAULT_TRADE_PARAMS } from "@/lib/trades/analyze";
import type { ValueSource } from "@/lib/values/engine";
import type { StartingSlot } from "@/lib/values/vor";

import {
  CYCLE_LIMITS,
  searchCycles,
  worstLeg,
  type CycleSuggestion,
} from "./cycles";
import {
  FAIR_BAND,
  MIN_LINEUP_GAIN,
  searchWinWin,
  type SuggestionAsset,
  type SuggestionTeam,
} from "./search";

function asset(
  playerId: number,
  {
    teamId = "A",
    position = "RB",
    value = 3000,
    points = 100,
    source = "market",
  }: Partial<Omit<SuggestionAsset, "playerId">> & { source?: ValueSource } = {},
): SuggestionAsset {
  return { playerId, teamId, position, value, points, source };
}

function team(
  teamId: string,
  roster: SuggestionAsset[],
  {
    surplusZ = {},
    need = {},
  }: { surplusZ?: Record<string, number>; need?: Record<string, number> } = {},
): SuggestionTeam {
  return {
    teamId,
    roster: roster.map((player) => ({ ...player, teamId })),
    surplusZ,
    need,
  };
}

const slot = (position: string, count: number): StartingSlot => ({
  position,
  count,
  isStarting: true,
});

/** One of each. Enough for a roster to have a hole that only one position fills. */
const SLOTS: StartingSlot[] = [slot("RB", 1), slot("WR", 1), slot("TE", 1)];

/**
 * The league three-team trades exist for.
 *
 * Each roster has one surplus and one hole, and they are arranged in a ring:
 * A is deep at running back and empty at tight end, B is deep at receiver and
 * empty at running back, C is deep at tight end and empty at receiver. Nobody's
 * surplus is what the team they could pair off with is short of, so **no
 * two-team trade helps both sides** — asserted below rather than asserted by
 * hand — while the cycle A → B → C → A helps all three: the backs go to the
 * team with none, the receivers to the team with none, the tight ends home.
 *
 * The 205s matter as much as the 40s. Each roster's non-hole starters are
 * pitched just above anything on offer, so receiving a package that is not the
 * one filling the hole is worth nothing. Without that, every pair has a
 * five-point upgrade sitting in it and the ring is no longer the only answer.
 */
function ringLeague(value = 3000): SuggestionTeam[] {
  return [
    team(
      "A",
      [
        asset(1, { position: "RB", points: 200, value }),
        asset(2, { position: "RB", points: 190, value }),
        asset(3, { position: "WR", points: 205, value }),
        asset(4, { position: "TE", points: 40, value }),
      ],
      { surplusZ: { RB: 1.2 }, need: { TE: 1.2 } },
    ),
    team(
      "B",
      [
        asset(11, { position: "WR", points: 200, value }),
        asset(12, { position: "WR", points: 190, value }),
        asset(13, { position: "TE", points: 205, value }),
        asset(14, { position: "RB", points: 40, value }),
      ],
      { surplusZ: { WR: 1.2 }, need: { RB: 1.2 } },
    ),
    team(
      "C",
      [
        asset(21, { position: "TE", points: 200, value }),
        asset(22, { position: "TE", points: 190, value }),
        asset(23, { position: "RB", points: 205, value }),
        asset(24, { position: "WR", points: 40, value }),
      ],
      { surplusZ: { TE: 1.2 }, need: { WR: 1.2 } },
    ),
  ];
}

/** Every leg re-scored from scratch, the way the analyzer would if asked again. */
function reScore(cycle: CycleSuggestion) {
  return cycle.legs.map((leg, index) => {
    const received = cycle.legs[(index + 2) % 3].assets;
    return analyzeTrade(leg.assets, received, DEFAULT_TRADE_PARAMS);
  });
}

describe("the cycle search (Requirement 11)", () => {
  it("finds a three-team trade in a league where no two-team trade works", () => {
    const league = ringLeague();

    // The premise, checked rather than assumed: Phase 8's exhaustive two-team
    // search over the same rosters comes back empty.
    expect(searchWinWin(league, SLOTS).suggestions).toEqual([]);

    const { cycles, stats } = searchCycles(
      { anchorTeamId: "A", teams: league },
      SLOTS,
    );

    expect(stats.blocked).toBeNull();
    expect(cycles.length).toBeGreaterThan(0);

    const best = cycles[0];
    // The ring runs the only way it can: A's running backs to the team with
    // none, and so on round.
    expect(best.legs.map((leg) => leg.teamId)).toEqual(["A", "B", "C"]);
    expect(best.legs.map((leg) => leg.toTeamId)).toEqual(["B", "C", "A"]);
    expect(best.legs.map((leg) => leg.assets[0].position)).toEqual([
      "RB",
      "WR",
      "TE",
    ]);
    expect(best.score.minGain).toBeCloseTo(150, 6);
    expect(best.score.bodies).toBe(3);
  });

  it("is a ring: every leg's incoming package is the one behind it", () => {
    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );

    for (const cycle of cycles) {
      expect(cycle.anchorTeamId).toBe("A");
      expect(cycle.legs[0].teamId).toBe("A");

      for (let index = 0; index < 3; index += 1) {
        const leg = cycle.legs[index];
        const next = cycle.legs[(index + 1) % 3];
        const behind = cycle.legs[(index + 2) % 3];

        expect(leg.toTeamId).toBe(next.teamId);
        // The analysis on a leg is that team's own ledger and nothing else:
        // what they send on one side, what reaches them on the other.
        expect(leg.analysis.a.assets).toBe(leg.assets);
        expect(leg.analysis.b.assets).toBe(behind.assets);
      }
    }
  });

  it("scores every leg with the analyzer rather than beside it (§6)", () => {
    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );

    expect(cycles.length).toBeGreaterThan(0);
    for (const cycle of cycles) {
      for (const [index, rerun] of reScore(cycle).entries()) {
        expect(rerun.verdict).not.toBeNull();
        expect(rerun.verdict!.pct).toBeCloseTo(
          cycle.legs[index].analysis.verdict!.pct,
          12,
        );
        // The invariant the whole phase turns on: no participant may be handed
        // a deal the app's own verdict panel would argue against.
        expect(rerun.verdict!.pct).toBeLessThan(FAIR_BAND);
        expect(["even", "slight"]).toContain(rerun.verdict!.band);
      }
    }
  });

  it("improves all three starting lineups, not two of them", () => {
    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );

    expect(cycles.length).toBeGreaterThan(0);
    for (const cycle of cycles) {
      for (const leg of cycle.legs) {
        expect(leg.lineup.delta).toBeGreaterThan(MIN_LINEUP_GAIN);
      }
      expect(cycle.score.minGain).toBeCloseTo(
        Math.min(...cycle.legs.map((leg) => leg.lineup.delta)),
        9,
      );
      expect(cycle.score.pct).toBeCloseTo(
        Math.max(...cycle.legs.map((leg) => leg.analysis.verdict!.pct)),
        12,
      );
    }
  });

  it("reports the cycle at its worst leg, not its average", () => {
    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );

    for (const cycle of cycles) {
      const worst = worstLeg(cycle);
      for (const leg of cycle.legs) {
        expect(leg.analysis.verdict!.pct).toBeLessThanOrEqual(
          worst.analysis.verdict!.pct + 1e-12,
        );
      }
      expect(cycle.score.pct).toBeCloseTo(worst.analysis.verdict!.pct, 12);
    }
  });
});

describe("a cycle is only as fair as its worst leg", () => {
  /**
   * Fairness is not transitive, and this is the league that proves it.
   *
   * Prices climb 8% a leg: A's assets are worth 1,000, B's 1,080, C's 1,166.
   * Each *adjacent* pair is inside §6's band — the middle team is fine, the
   * third team is fine — and the leg that closes the ring is 14.8% apart, which
   * the analyzer calls a clear winner. Two fair legs do not add up to a fair
   * cycle, which is exactly why every participant is scored on their own ledger
   * rather than the ring being balanced as a whole.
   */
  function climbingLeague(): SuggestionTeam[] {
    const build = (
      teamId: string,
      base: number,
      value: number,
      shape: [string, number][],
    ) =>
      team(
        teamId,
        shape.map(([position, points], index) =>
          asset(base + index, { position, points, value }),
        ),
      );

    return [
      // A is deep at running back and empty at tight end; B is deep at
      // receiver and empty at running back; C is deep at tight end and empty at
      // receiver — the same ring as above, so all three lineups would gain.
      build("A", 1, 1000, [
        ["RB", 200],
        ["RB", 190],
        ["WR", 205],
        ["TE", 40],
      ]),
      build("B", 11, 1080, [
        ["WR", 200],
        ["WR", 190],
        ["TE", 205],
        ["RB", 40],
      ]),
      build("C", 21, 1166, [
        ["TE", 200],
        ["TE", 190],
        ["RB", 205],
        ["WR", 40],
      ]),
    ];
  }

  it("rejects a cycle whose two other legs are fair", () => {
    const league = climbingLeague();
    const { cycles, stats } = searchCycles(
      { anchorTeamId: "A", teams: league },
      SLOTS,
    );

    // The opening was reached and passed — B's own ledger is fair and B's
    // lineup improves — so the rejection happened where it should, on the leg
    // that closes the ring rather than before the search got there.
    expect(stats.viable).toBeGreaterThan(0);
    expect(cycles).toEqual([]);
    expect(stats.cycles).toBe(0);
  });

  it("and the three legs are why: two inside the band, one clearly not", () => {
    const [a, b, c] = climbingLeague();
    const send = (from: SuggestionTeam) => [from.roster[1]];

    // B sends its surplus receiver and receives A's surplus back.
    const middle = analyzeTrade(send(b), send(a)).verdict!;
    // C sends its surplus tight end and receives B's receiver.
    const third = analyzeTrade(send(c), send(b)).verdict!;
    // A sends its surplus back and receives C's tight end — two 8% steps.
    const anchor = analyzeTrade(send(a), send(c)).verdict!;

    expect(middle.pct).toBeLessThan(FAIR_BAND);
    expect(third.pct).toBeLessThan(FAIR_BAND);
    expect(anchor.pct).toBeGreaterThan(FAIR_BAND);
    expect(anchor.band).toBe("clear");
  });
});

describe("the degenerate cases", () => {
  it("says so when the anchor is not a team in this league", () => {
    const { cycles, stats } = searchCycles(
      { anchorTeamId: "NOBODY", teams: ringLeague() },
      SLOTS,
    );

    expect(stats.blocked).toBe("no-anchor");
    expect(cycles).toEqual([]);
  });

  it("says so when the league has fewer than three teams", () => {
    const [a, b] = ringLeague();
    const { cycles, stats } = searchCycles(
      { anchorTeamId: "A", teams: [a, b] },
      SLOTS,
    );

    expect(stats.blocked).toBe("too-few-teams");
    expect(stats.orientations).toBe(0);
    expect(cycles).toEqual([]);
  });

  it("says so when a third of the league has nothing tradeable to put in", () => {
    const [a, b] = ringLeague();
    // Kickers, defenses and unvalued players are all excluded from packages, so
    // this team exists but cannot be in a cycle — which is a different answer
    // from "there are only two teams" and reads differently to a user.
    const bare = team("C", [
      asset(21, { position: "K", points: 130, value: 40 }),
      asset(22, { position: "DEF", points: 120, value: 40 }),
      asset(23, { position: "TE", points: 190, value: 1, source: "floor" }),
    ]);

    const { cycles, stats } = searchCycles(
      { anchorTeamId: "A", teams: [a, b, bare] },
      SLOTS,
    );

    expect(stats.blocked).toBe("no-pieces");
    expect(stats.unvalued).toBe(1);
    expect(cycles).toEqual([]);
  });

  it("finds nothing when no cycle exists, and does not call that an error", () => {
    // Three identical rosters. Every swap is fair and none of them moves a
    // lineup, so the ring closes on nobody.
    const shape: [string, number][] = [
      ["RB", 200],
      ["WR", 190],
      ["TE", 180],
    ];
    const clones = ["A", "B", "C"].map((id, index) =>
      team(
        id,
        shape.map(([position, points], slotIndex) =>
          asset(index * 10 + slotIndex + 1, { position, points }),
        ),
      ),
    );

    const { cycles, stats } = searchCycles(
      { anchorTeamId: "A", teams: clones },
      SLOTS,
    );

    expect(stats.blocked).toBeNull();
    expect(stats.orientations).toBe(2);
    expect(stats.space).toBeGreaterThan(0);
    expect(cycles).toEqual([]);
  });

  it("never puts an unvalued player in a leg, and counts the ones it held back (§4)", () => {
    const league = ringLeague();
    league[0].roster.push(
      asset(5, { teamId: "A", position: "WR", points: 195, value: 1, source: "floor" }),
    );
    league[1].roster.push(
      asset(15, { teamId: "B", position: "TE", points: 195, value: 1, source: "floor" }),
    );

    const { cycles, stats } = searchCycles(
      { anchorTeamId: "A", teams: league },
      SLOTS,
    );

    expect(stats.unvalued).toBe(2);
    const moving = cycles.flatMap((cycle) => cycle.legs.flatMap((leg) => leg.assets));
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.some((player) => player.source === "floor")).toBe(false);
  });

  it("never puts a kicker or a defense in a leg (§3)", () => {
    const league = ringLeague();
    league[0].roster.push(asset(6, { teamId: "A", position: "K", points: 140 }));
    league[2].roster.push(asset(26, { teamId: "C", position: "DEF", points: 140 }));

    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: league },
      SLOTS,
    );

    const moving = cycles.flatMap((cycle) => cycle.legs.flatMap((leg) => leg.assets));
    expect(moving.some((player) => player.position === "K")).toBe(false);
    expect(moving.some((player) => player.position === "DEF")).toBe(false);
  });
});

describe("the ranking", () => {
  const identity = (cycle: CycleSuggestion) =>
    cycle.legs
      .map((leg) => `${leg.teamId}:${leg.assets.map((a) => a.playerId).join("+")}`)
      .join(">");

  it("answers the same way whatever order the league arrives in", () => {
    const forwards = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    ).cycles;
    const backwards = searchCycles(
      { anchorTeamId: "A", teams: [...ringLeague()].reverse() },
      SLOTS,
    ).cycles;

    expect(backwards.map(identity)).toEqual(forwards.map(identity));
    expect(forwards.length).toBeGreaterThan(1);
  });

  it("puts the cycle with the largest smallest gain first", () => {
    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );

    const mins = cycles.map((cycle) => cycle.score.minGain);
    expect(mins).toEqual([...mins].sort((x, y) => y - x));
  });

  /**
   * The beam's sort key, pinned.
   *
   * On this league the anchor's second-best running back is a bench player and
   * its best is a starter, and handing over the starter pays the middle team
   * ten points more. A beam sorted on the middle team's gain alone — which is a
   * genuine upper bound on the objective, and was the first key tried — fills
   * itself with those openings and returns a cycle worth 140 to the team that
   * asked, while the one worth 150 sits just under the cut. Charging the
   * anchor's own cost against that gain is what fixes it, and this is the test
   * that would fail if the key ever went back.
   */
  it("does not overpay the middle team out of the anchor's own lineup", () => {
    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );

    // 150, not 140. Under the discarded key the beam filled with openings that
    // hand the middle team a starter, and the anchor paid the ten points.
    expect(cycles[0].score.minGain).toBeCloseTo(150, 6);
    expect(cycles[0].legs[0].lineup.delta).toBeCloseTo(150, 6);
  });

  it("holds to the menu size and shows three different headline swaps", () => {
    const { cycles } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );

    expect(cycles.length).toBeLessThanOrEqual(CYCLE_LIMITS.results);

    const headlines = cycles.map((cycle) =>
      cycle.legs.map((leg) => leg.analysis.a.best?.playerId).join(">"),
    );
    expect(new Set(headlines).size).toBe(headlines.length);
  });

  it("searches both directions round the ring", () => {
    // A league with two surpluses per team, so both orientations close. The
    // orientation count is the claim: eleven partners × ten thirds in a
    // twelve-team league, two of each in a three-team one.
    const { stats } = searchCycles(
      { anchorTeamId: "A", teams: ringLeague() },
      SLOTS,
    );
    expect(stats.orientations).toBe(2);
    expect(searchCycles({ anchorTeamId: "T0", teams: syntheticLeague(12, 15) }, SLOTS)
      .stats.orientations).toBe(11 * 10);
  });
});

// ---------------------------------------------------------------------------
// a league big enough to time
// ---------------------------------------------------------------------------

/**
 * The same deterministic twelve-team league `search.test.ts` uses, on a value
 * curve shaped like FantasyCalc's: a #1 near 10,000 falling away convexly. No
 * randomness — a timing test that fails on a seed tells nobody anything.
 */
function syntheticLeague(teams: number, size: number): SuggestionTeam[] {
  const positions = ["QB", "RB", "WR", "TE", "RB", "WR"];
  const built: SuggestionTeam[] = [];

  for (let t = 0; t < teams; t += 1) {
    const roster: SuggestionAsset[] = [];

    for (let p = 0; p < size; p += 1) {
      const overall = p * teams + ((t * 7) % teams) + 1;
      roster.push(
        asset(t * 100 + p + 1, {
          teamId: `T${t}`,
          position: positions[(t + p) % positions.length],
          value: Math.round(10_000 * Math.exp(-overall / 28)) + 1,
          points: Math.round(320 * Math.exp(-overall / 55)),
        }),
      );
    }

    built.push(
      team(`T${t}`, roster, {
        surplusZ: { RB: ((t % 5) - 2) / 2, WR: ((t % 3) - 1) / 2 },
        need: { RB: (2 - (t % 5)) / 2, WR: (1 - (t % 3)) / 2 },
      }),
    );
  }

  return built;
}

const FLEX_SLOTS: StartingSlot[] = [
  slot("QB", 1),
  slot("RB", 2),
  slot("WR", 2),
  slot("TE", 1),
  slot("W/R/T", 1),
];

describe("the bounds, measured", () => {
  it("stands in for a space it never enumerates", () => {
    const { stats } = searchCycles(
      { anchorTeamId: "T0", teams: syntheticLeague(12, 15) },
      FLEX_SLOTS,
    );

    // §7's bounds: top 6 assets, ≤ 2 per leg — C(6,1) + C(6,2) = 21 packages a
    // team, so 110 orientations × 21³ candidates stand behind this search.
    expect(stats.space).toBe(11 * 10 * 21 * 21 * 21);
    // What it actually scored is orders of magnitude below that, and every
    // candidate it skipped was skipped by one of the two named mechanisms.
    expect(stats.openings + stats.openingsPruned).toBe(11 * 21 * 21);
    expect(stats.openings).toBeLessThan(stats.space / 100);
    expect(stats.closings + stats.closingsPruned).toBe(stats.beam * 10 * 21);
  });

  it("keeps the beam inside its width and its per-partner cap", () => {
    const { stats } = searchCycles(
      { anchorTeamId: "T0", teams: syntheticLeague(12, 15) },
      FLEX_SLOTS,
    );

    expect(stats.beam).toBeLessThanOrEqual(CYCLE_LIMITS.beamWidth);
    expect(stats.beam + stats.dropped).toBe(stats.viable);
  });

  it("is a beam and says so: a narrower one can find less", () => {
    const league = syntheticLeague(12, 15);
    const wide = searchCycles(
      { anchorTeamId: "T0", teams: league },
      FLEX_SLOTS,
      DEFAULT_TRADE_PARAMS,
      CYCLE_LIMITS,
    );
    const narrow = searchCycles(
      { anchorTeamId: "T0", teams: league },
      FLEX_SLOTS,
      DEFAULT_TRADE_PARAMS,
      { ...CYCLE_LIMITS, beamWidth: 1, beamPerPartner: 1 },
    );

    // The point of the assertion is the inequality, not the numbers: a beam is
    // a truncation, so narrowing it loses cycles that genuinely exist. This is
    // the property the README's "where it falls short" is about.
    expect(narrow.stats.beam).toBe(1);
    expect(narrow.stats.dropped).toBeGreaterThan(0);
    expect(narrow.stats.cycles).toBeLessThanOrEqual(wide.stats.cycles);
  });

  it("searches a twelve-team league in a fraction of one sync stage", () => {
    const league = syntheticLeague(12, 15);

    const started = Date.now();
    // Twelve anchors is the whole league — the shape sync stage 8 would have
    // had to carry if this were cached rather than run on demand.
    for (const anchor of league) {
      searchCycles({ anchorTeamId: anchor.teamId, teams: league }, FLEX_SLOTS);
    }
    const elapsed = Date.now() - started;

    // §9 caps a stage at ~60s. Five seconds for all twelve anchors is a ceiling
    // with an order of magnitude of headroom over what this costs, chosen so
    // the assertion fails on a regression rather than on a busy CI box.
    expect(elapsed).toBeLessThan(5000);
  });
});

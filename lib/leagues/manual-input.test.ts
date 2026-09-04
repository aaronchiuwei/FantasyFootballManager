import { describe, expect, it } from "vitest";

import {
  formatLineup,
  normalizeSlotName,
  numQbsFor,
  parseLineup,
  parseTeamNames,
  planManualLeague,
  planManualSettings,
} from "./manual-input";

const FORM = {
  name: "The Ditka Memorial",
  season: "2026",
  ppr: "0.5",
  lineup: "QB, 2×RB, 3×WR, TE, W/R/T, K, DEF, 6×BN",
  teams: "Ditka\nPapa Bear\nMonsters\nSweetness",
  scoringLabel: "Half PPR",
  startWeek: "1",
  endWeek: "16",
};

describe("normalizeSlotName", () => {
  it("accepts Yahoo's own spellings unchanged", () => {
    for (const slot of ["QB", "RB", "WR", "TE", "K", "DEF", "W/R/T", "Q/W/R/T", "BN", "IR"]) {
      expect(normalizeSlotName(slot)).toBe(slot);
    }
  });

  it("folds the names people actually type", () => {
    expect(normalizeSlotName("flex")).toBe("W/R/T");
    expect(normalizeSlotName("Superflex")).toBe("Q/W/R/T");
    expect(normalizeSlotName("d/st")).toBe("DEF");
    expect(normalizeSlotName("DST")).toBe("DEF");
    expect(normalizeSlotName("bench")).toBe("BN");
    expect(normalizeSlotName(" rb ")).toBe("RB");
  });

  it("refuses a slot it cannot fill a seat from", () => {
    expect(normalizeSlotName("")).toBeNull();
    expect(normalizeSlotName("LB")).toBeNull();
    expect(normalizeSlotName("bananas")).toBeNull();
  });
});

describe("parseLineup", () => {
  it("reads counts written three different ways", () => {
    const { slots } = parseLineup("2×RB, WR x3, TE, TE");
    expect(slots.map((slot) => [slot.position, slot.count])).toEqual([
      ["RB", 2],
      ["WR", 3],
      ["TE", 2],
    ]);
  });

  it("keeps the order the league was typed in", () => {
    const { slots } = parseLineup("QB, RB, WR, RB, TE");
    expect(slots.map((slot) => slot.position)).toEqual(["QB", "RB", "WR", "TE"]);
  });

  it("marks bench and IR as non-starting", () => {
    const { slots } = parseLineup("QB, 6×BN, IR");
    expect(slots.map((slot) => slot.isStarting)).toEqual([true, false, false]);
  });

  it("hands back what it could not read rather than guessing", () => {
    const { slots, unknown } = parseLineup("QB, LB, DL");
    expect(slots.map((slot) => slot.position)).toEqual(["QB"]);
    expect(unknown).toEqual(["LB", "DL"]);
  });

  it("ignores empty entries and a slot of size zero", () => {
    const { slots, unknown } = parseLineup("QB, , 0×WR\nRB");
    expect(slots.map((slot) => slot.position)).toEqual(["QB", "RB"]);
    expect(unknown).toEqual([]);
  });

  it("round-trips through formatLineup", () => {
    const text = "QB, 2×RB, 3×WR, TE, W/R/T, K, DEF, 6×BN";
    expect(formatLineup(parseLineup(text).slots)).toBe(text);
  });
});

describe("numQbsFor", () => {
  const lineup = (text: string) => parseLineup(text).slots;

  it("reads one for a single-QB league", () => {
    expect(numQbsFor(lineup("QB, 2×RB, 3×WR, TE, W/R/T, K, DEF"))).toBe(1);
  });

  it("reads superflex off the flex slot, not off a label", () => {
    expect(numQbsFor(lineup("QB, 2×RB, 3×WR, TE, Q/W/R/T, K, DEF"))).toBe(2);
  });

  it("treats two hard QB slots as the same league", () => {
    expect(numQbsFor(lineup("2×QB, 2×RB, 3×WR, TE"))).toBe(2);
  });

  it("does not count a bench QB slot as a starter", () => {
    expect(numQbsFor(lineup("QB, 6×BN"))).toBe(1);
  });
});

describe("parseTeamNames", () => {
  it("takes one team per line and collapses whitespace", () => {
    expect(parseTeamNames("  Ditka \n\n Papa   Bear \n").names).toEqual([
      "Ditka",
      "Papa Bear",
    ]);
  });

  it("refuses two teams with the same name", () => {
    const result = parseTeamNames("Ditka\nditka");
    expect(result.duplicate).toBe("ditka");
  });
});

describe("planManualLeague", () => {
  it("turns a filled-in form into a league and its teams", () => {
    const result = planManualLeague(FORM);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.name).toBe("The Ditka Memorial");
    expect(result.plan.season).toBe(2026);
    expect(result.plan.ppr).toBe(0.5);
    expect(result.plan.numQbs).toBe(1);
    expect(result.plan.numTeams).toBe(4);
    expect(result.plan.teamNames).toHaveLength(4);
    expect(result.plan.isDynasty).toBe(false);
    expect(result.plan.startWeek).toBe(1);
    expect(result.plan.endWeek).toBe(16);
    expect(formatLineup(result.plan.rosterSlots)).toBe(FORM.lineup);
  });

  it("derives superflex from the lineup", () => {
    const result = planManualLeague({ ...FORM, lineup: "QB, Q/W/R/T, 2×RB, 2×WR" });
    expect(result.ok && result.plan.numQbs).toBe(2);
  });

  it("reads a ticked checkbox as dynasty", () => {
    const result = planManualLeague({ ...FORM, isDynasty: "on" });
    expect(result.ok && result.plan.isDynasty).toBe(true);
  });

  it("refuses a lineup with nothing startable in it", () => {
    const result = planManualLeague({ ...FORM, lineup: "6×BN" });
    expect(result).toMatchObject({ ok: false });
  });

  it("names the slot it could not read", () => {
    const result = planManualLeague({ ...FORM, lineup: "QB, LB" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("LB");
  });

  it("refuses a one-team league", () => {
    const result = planManualLeague({ ...FORM, teams: "Ditka" });
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a season that ends before it starts", () => {
    const result = planManualLeague({ ...FORM, startWeek: "14", endWeek: "1" });
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses an empty name", () => {
    expect(planManualLeague({ ...FORM, name: "   " })).toMatchObject({ ok: false });
  });
});

const SETTINGS_ONLY = (() => {
  const { teams, ...rest } = FORM;
  void teams;
  return rest;
})();

describe("planManualSettings", () => {
  it("reads the settings without asking for teams", () => {
    const result = planManualSettings(SETTINGS_ONLY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.name).toBe("The Ditka Memorial");
    expect(result.plan.numQbs).toBe(1);
  });

  it("still holds the lineup to the same standard", () => {
    expect(
      planManualSettings({ ...SETTINGS_ONLY, lineup: "LB" }),
    ).toMatchObject({ ok: false });
  });
});

describe("the current week is not a form field", () => {
  it("ignores one even when a caller sends it", () => {
    // It belongs to sync stage 1, which reads the live NFL week from Sleeper.
    // A typed answer is right for a week and wrong for the rest of the season.
    const plan = planManualLeague({ ...FORM, currentWeek: "7" });
    expect(plan.ok).toBe(true);
    expect(plan.ok && "currentWeek" in plan.plan).toBe(false);
  });
});

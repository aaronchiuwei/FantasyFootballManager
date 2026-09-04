import { describe, expect, it } from "vitest";

import {
  activeSection,
  LEAGUE_SECTIONS,
  sectionHref,
  sectionsFor,
  switchHref,
  type LeagueSectionKey,
} from "./nav";

const LEAGUE = "8f14e45f-ceea-467a-9b47-0e79b7b1c0a1";
const OTHER = "0f14e45f-ceea-467a-9b47-0e79b7b1c0a1";

describe("sectionHref", () => {
  it("gives the league page itself no trailing segment", () => {
    const league = LEAGUE_SECTIONS.find((entry) => entry.key === "league")!;
    expect(sectionHref(LEAGUE, league)).toBe(`/leagues/${LEAGUE}`);
  });

  it("appends the segment for every other section", () => {
    for (const section of LEAGUE_SECTIONS) {
      if (section.key === "league") continue;
      expect(sectionHref(LEAGUE, section)).toBe(
        `/leagues/${LEAGUE}/${section.segment}`,
      );
    }
  });
});

describe("activeSection", () => {
  it("round-trips every section's own href", () => {
    for (const section of LEAGUE_SECTIONS) {
      expect(activeSection(sectionHref(LEAGUE, section), LEAGUE)).toBe(
        section.key,
      );
    }
  });

  it("lights the values tab on a player page", () => {
    expect(activeSection(`/leagues/${LEAGUE}/players/4046`, LEAGUE)).toBe(
      "values",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(activeSection(`/leagues/${LEAGUE}/`, LEAGUE)).toBe("league");
    expect(activeSection(`/leagues/${LEAGUE}/waivers/`, LEAGUE)).toBe("waivers");
  });

  it("claims nothing outside this league", () => {
    expect(activeSection(`/leagues/${OTHER}/values`, LEAGUE)).toBeNull();
    expect(activeSection("/leagues", LEAGUE)).toBeNull();
    expect(activeSection("/dashboard", LEAGUE)).toBeNull();
  });

  it("does not match a league id that merely starts the same way", () => {
    expect(activeSection(`/leagues/${LEAGUE}extra/values`, LEAGUE)).toBeNull();
  });

  it("returns null for a segment no section owns", () => {
    expect(activeSection(`/leagues/${LEAGUE}/nonsense`, LEAGUE)).toBeNull();
  });

  it("has no duplicate keys or segments", () => {
    const keys = LEAGUE_SECTIONS.map((entry) => entry.key as LeagueSectionKey);
    const segments = LEAGUE_SECTIONS.map((entry) => entry.segment);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(segments).size).toBe(segments.length);
  });
});

describe("sectionsFor", () => {
  it("gives a Yahoo league its identity queue and no editing screens", () => {
    const keys = sectionsFor("yahoo").map((section) => section.key);
    expect(keys).toContain("identity");
    expect(keys).not.toContain("manage");
    expect(keys).not.toContain("moves");
  });

  it("gives a manual league the editing screens and no identity queue", () => {
    const keys = sectionsFor("manual").map((section) => section.key);
    expect(keys).toEqual(
      expect.arrayContaining(["manage", "moves"]),
    );
    expect(keys).not.toContain("identity");
  });

  it("treats an unknown or missing source as Yahoo", () => {
    const yahoo = sectionsFor("yahoo").map((section) => section.key);
    expect(sectionsFor(null).map((section) => section.key)).toEqual(yahoo);
    expect(sectionsFor(undefined).map((section) => section.key)).toEqual(yahoo);
    expect(sectionsFor("sleeper").map((section) => section.key)).toEqual(yahoo);
    // ESPN is imported, so it gets the identity queue and not the editors.
    expect(sectionsFor("espn").map((section) => section.key)).toEqual(yahoo);
  });

  it("keeps every league's shared sections in the same order", () => {
    const shared = LEAGUE_SECTIONS.filter((section) => !section.only).map(
      (section) => section.key,
    );

    for (const source of ["yahoo", "manual"]) {
      const keys = sectionsFor(source).map((section) => section.key);
      expect(keys.filter((key) => shared.includes(key))).toEqual(shared);
    }
  });
});

describe("switchHref", () => {
  it("lands on the same section of the other league", () => {
    expect(switchHref(OTHER, "yahoo", "waivers")).toBe(`/leagues/${OTHER}/waivers`);
    expect(switchHref(OTHER, "manual", "values")).toBe(`/leagues/${OTHER}/values`);
  });

  it("carries every shared section across either way", () => {
    for (const section of LEAGUE_SECTIONS) {
      if (section.only) continue;
      for (const source of ["yahoo", "manual"]) {
        expect(switchHref(OTHER, source, section.key)).toBe(
          sectionHref(OTHER, section),
        );
      }
    }
  });

  it("falls back to the league page when the target has no such section", () => {
    expect(switchHref(OTHER, "manual", "identity")).toBe(`/leagues/${OTHER}`);
    expect(switchHref(OTHER, "yahoo", "moves")).toBe(`/leagues/${OTHER}`);
    expect(switchHref(OTHER, "yahoo", "manage")).toBe(`/leagues/${OTHER}`);
  });

  it("keeps a manual-only section when both leagues are manual", () => {
    expect(switchHref(OTHER, "manual", "moves")).toBe(`/leagues/${OTHER}/moves`);
  });

  it("sends the league section and an unknown path to the league page", () => {
    expect(switchHref(OTHER, "yahoo", "league")).toBe(`/leagues/${OTHER}`);
    expect(switchHref(OTHER, "yahoo", null)).toBe(`/leagues/${OTHER}`);
  });
});

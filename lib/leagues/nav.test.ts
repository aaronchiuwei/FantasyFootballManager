import { describe, expect, it } from "vitest";

import {
  activeSection,
  LEAGUE_SECTIONS,
  sectionHref,
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

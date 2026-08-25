import { describe, expect, it } from "vitest";

import { normalizeName } from "./name-normalize";

describe("normalizeName", () => {
  it("matches the examples in the plan", () => {
    expect(normalizeName("D'Andre Swift")).toBe("dandreswift");
    expect(normalizeName("Ja'Marr Chase")).toBe("jamarrchase");
  });

  it("drops suffixes", () => {
    expect(normalizeName("Michael Pittman Jr.")).toBe("michaelpittman");
    expect(normalizeName("Kenneth Walker III")).toBe("kennethwalker");
    expect(normalizeName("Odell Beckham Jr")).toBe("odellbeckham");
  });

  it("strips diacritics and punctuation", () => {
    expect(normalizeName("Amon-Ra St. Brown")).toBe("amonrastbrown");
    expect(normalizeName("Equanimeous Tristan Imhotep-Jr")).toBe(
      "equanimeoustristanimhotep",
    );
    expect(normalizeName("Bryce Peña")).toBe("brycepena");
  });

  it("collapses whitespace and case", () => {
    expect(normalizeName("  JOSH   ALLEN ")).toBe("joshallen");
  });
});

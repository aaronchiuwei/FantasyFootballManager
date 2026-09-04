import { describe, expect, it } from "vitest";

import { providerLabels } from "./provider";

describe("providerLabels", () => {
  it("names ESPN as ESPN", () => {
    expect(providerLabels("espn")).toEqual({ name: "ESPN", idPrefix: "espn" });
  });

  it("names Yahoo as Yahoo", () => {
    expect(providerLabels("yahoo").idPrefix).toBe("yahoo");
  });

  it("has an answer for a hand-kept league", () => {
    expect(providerLabels("manual").idPrefix).toBe("manual");
  });

  it("falls back rather than rendering nothing", () => {
    // Every league predating the `source` column is a Yahoo league, and a
    // blank where an id prefix should be is worse than a wrong one.
    expect(providerLabels(null).idPrefix).toBe("yahoo");
    expect(providerLabels(undefined).idPrefix).toBe("yahoo");
    expect(providerLabels("sleeper").idPrefix).toBe("yahoo");
  });
});

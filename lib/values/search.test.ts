import { describe, expect, it } from "vitest";

import { MIN_QUERY_LENGTH, searchLabel, searchPattern } from "./search";

describe("searchPattern", () => {
  it("is not a search until it is long enough", () => {
    expect(searchPattern(undefined)).toBeNull();
    expect(searchPattern("")).toBeNull();
    expect(searchPattern("   ")).toBeNull();
    expect(searchPattern("a")).toBeNull();
    expect("ab".length).toBe(MIN_QUERY_LENGTH);
    expect(searchPattern("ab")).toBe("%ab%");
  });

  it("wraps the term so a surname matches mid-name", () => {
    expect(searchPattern("chase")).toBe("%chase%");
  });

  it("trims, because a trailing space is a typo and not a term", () => {
    expect(searchPattern("  jefferson  ")).toBe("%jefferson%");
  });

  /**
   * The reason this module exists. A user typing `%` means the character; left
   * alone it matches the whole board, which reads as the filter ignoring them.
   */
  it("escapes the SQL wildcards a user can type", () => {
    expect(searchPattern("100%")).toBe("%100\\%%");
    expect(searchPattern("a_b")).toBe("%a\\_b%");
  });

  /**
   * PostgREST rewrites `*` to `%` before Postgres sees the pattern, so a
   * backslash in front of it is not an escape — it is a literal backslash next
   * to a live wildcard.
   */
  it("drops PostgREST's own wildcard rather than escaping it", () => {
    expect(searchPattern("ch*se")).toBe("%chse%");
    expect(searchPattern("**")).toBeNull();
  });

  it("escapes backslashes before the wildcards, not after", () => {
    // Naive ordering turns `\` into `\\` *after* `%` became `\%`, producing
    // `\\%` — an escaped backslash followed by a live wildcard.
    expect(searchPattern("a\\%b")).toBe("%a\\\\\\%b%");
  });

  it("leaves the punctuation real names carry alone", () => {
    expect(searchPattern("Ja'Marr")).toBe("%Ja'Marr%");
    expect(searchPattern("Smith-Njigba")).toBe("%Smith-Njigba%");
    expect(searchPattern("D.J. Moore")).toBe("%D.J. Moore%");
  });

  it("caps a paste rather than sending it", () => {
    const pattern = searchPattern("x".repeat(500));
    expect(pattern).toBe(`%${"x".repeat(60)}%`);
  });
});

describe("searchLabel", () => {
  it("echoes what was typed, trimmed", () => {
    expect(searchLabel("  chase ")).toBe("chase");
    expect(searchLabel(undefined)).toBe("");
  });

  it("does not show the user the escaping", () => {
    expect(searchLabel("100%")).toBe("100%");
  });
});

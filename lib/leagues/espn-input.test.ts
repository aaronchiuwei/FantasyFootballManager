import { describe, expect, it } from "vitest";

import {
  latestEspnSeason,
  parseEspnLeagueId,
  parseEspnSeason,
  planEspnConnect,
} from "./espn-input";

/** August 2026: the 2026 season is the one being played. */
const NOW = new Date("2026-08-15T00:00:00Z");

describe("parseEspnLeagueId", () => {
  it("takes a bare id", () => {
    expect(parseEspnLeagueId("  123456 ")).toBe("123456");
  });

  it("takes the URL people actually copy", () => {
    expect(
      parseEspnLeagueId(
        "https://fantasy.espn.com/football/league?leagueId=123456&seasonId=2026",
      ),
    ).toBe("123456");
    expect(
      parseEspnLeagueId("https://fantasy.espn.com/football/team?leagueId=99&teamId=3"),
    ).toBe("99");
    expect(parseEspnLeagueId("fantasy.espn.com/football/league/7654321")).toBe(
      "7654321",
    );
  });

  it("refuses what carries no id", () => {
    expect(parseEspnLeagueId("")).toBeNull();
    expect(parseEspnLeagueId("my league")).toBeNull();
    expect(parseEspnLeagueId("https://fantasy.espn.com/football/")).toBeNull();
  });
});

describe("parseEspnSeason", () => {
  it("reads the season off a URL", () => {
    expect(parseEspnSeason("?leagueId=1&seasonId=2024")).toBe(2024);
    expect(parseEspnSeason("123456")).toBeNull();
  });
});

describe("latestEspnSeason", () => {
  it("turns over in the summer, not in January", () => {
    expect(latestEspnSeason(new Date("2026-02-01T00:00:00Z"))).toBe(2025);
    expect(latestEspnSeason(new Date("2026-07-01T00:00:00Z"))).toBe(2026);
  });
});

describe("planEspnConnect", () => {
  it("reads a public league off a bare id", () => {
    const planned = planEspnConnect({ leagueId: "123456" }, NOW);

    expect(planned).toEqual({
      ok: true,
      plan: { ref: { leagueId: "123456", season: 2026 }, cookies: null },
    });
  });

  it("prefers the typed season, then the URL's, then today's", () => {
    expect(
      planEspnConnect({ leagueId: "123456", season: 2024 }, NOW),
    ).toMatchObject({ plan: { ref: { season: 2024 } } });

    expect(
      planEspnConnect({ leagueId: "?leagueId=123456&seasonId=2023" }, NOW),
    ).toMatchObject({ plan: { ref: { season: 2023 } } });
  });

  it("braces a SWID pasted without them", () => {
    const planned = planEspnConnect(
      { leagueId: "1", swid: " AAAA-BBBB ", espnS2: " AEBxyz " },
      NOW,
    );

    expect(planned).toMatchObject({
      plan: { cookies: { swid: "{AAAA-BBBB}", espnS2: "AEBxyz" } },
    });
  });

  it("takes half a cookie pair for the typo it is", () => {
    expect(planEspnConnect({ leagueId: "1", swid: "{A}" }, NOW)).toMatchObject({
      ok: false,
    });
    expect(
      planEspnConnect({ leagueId: "1", espnS2: "AEBxyz" }, NOW),
    ).toMatchObject({ ok: false });
  });

  it("refuses a season ESPN's v3 API cannot answer", () => {
    expect(planEspnConnect({ leagueId: "1", season: 2009 }, NOW)).toMatchObject({
      ok: false,
    });
    expect(planEspnConnect({ leagueId: "1", season: 2030 }, NOW)).toMatchObject({
      ok: false,
    });
    // Next season is a real thing to connect: leagues are created early.
    expect(planEspnConnect({ leagueId: "1", season: 2027 }, NOW)).toMatchObject({
      ok: true,
    });
  });

  it("says what is wrong rather than which field is", () => {
    const planned = planEspnConnect({ leagueId: "my league" }, NOW);

    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toMatch(/league id/i);
  });
});

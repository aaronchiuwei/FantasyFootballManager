import { describe, expect, it } from "vitest";

import {
  initials,
  isDefense,
  playerHeadshotUrl,
  teamLogoUrl,
} from "./headshot";

describe("playerHeadshotUrl", () => {
  it("addresses a person by Sleeper id", () => {
    expect(
      playerHeadshotUrl({ sleeperId: "4034", position: "RB", nflTeam: "SF" }),
    ).toBe("https://sleepercdn.com/content/nfl/players/4034.jpg");
  });

  it("sends a defense to the team logo, which is the only picture it has", () => {
    // The player path answers 403 for `PHI.jpg` rather than a placeholder, so
    // this branch is the difference between a picture and a broken image.
    expect(
      playerHeadshotUrl({ sleeperId: "PHI", position: "DEF", nflTeam: "PHI" }),
    ).toBe("https://sleepercdn.com/images/team_logos/nfl/phi.png");
  });

  it("falls back to a defense's own id when the team column is empty", () => {
    expect(
      playerHeadshotUrl({ sleeperId: "NYG", position: "DST", nflTeam: null }),
    ).toBe("https://sleepercdn.com/images/team_logos/nfl/nyg.png");
  });

  it("has no answer without an id, and says so rather than guessing", () => {
    expect(playerHeadshotUrl({ sleeperId: null, position: "WR" })).toBeNull();
    expect(playerHeadshotUrl({ sleeperId: "  ", position: "WR" })).toBeNull();
  });
});

describe("teamLogoUrl", () => {
  it("lowercases the abbreviation the CDN is keyed by", () => {
    expect(teamLogoUrl("KC")).toBe(
      "https://sleepercdn.com/images/team_logos/nfl/kc.png",
    );
  });

  it("is null for a free agent", () => {
    expect(teamLogoUrl(null)).toBeNull();
    expect(teamLogoUrl("")).toBeNull();
  });
});

describe("isDefense", () => {
  it("accepts every spelling the sources use", () => {
    expect(isDefense("DEF")).toBe(true);
    expect(isDefense("dst")).toBe(true);
    expect(isDefense("D/ST")).toBe(true);
  });

  it("rejects everyone who is a person", () => {
    expect(isDefense("WR")).toBe(false);
    expect(isDefense(null)).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first and last name, not the first two words", () => {
    expect(initials("Amon-Ra St. Brown")).toBe("AB");
    expect(initials("Christian McCaffrey")).toBe("CM");
  });

  it("handles a single word and an empty one", () => {
    expect(initials("Eagles")).toBe("E");
    expect(initials("   ")).toBe("--");
  });
});

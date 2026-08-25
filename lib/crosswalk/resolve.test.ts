import { describe, expect, it } from "vitest";

import {
  CandidateIndex,
  normalizePosition,
  normalizeTeam,
  type CrosswalkCandidate,
} from "./resolve";
import { trigramSimilarity } from "./similarity";

const CANDIDATES: CrosswalkCandidate[] = [
  {
    playerId: 1,
    searchName: "joshallen",
    fullName: "Josh Allen",
    position: "QB",
    nflTeam: "BUF",
    birthDate: "1996-05-21",
  },
  {
    playerId: 2,
    searchName: "jamarrchase",
    fullName: "Ja'Marr Chase",
    position: "WR",
    nflTeam: "CIN",
    birthDate: "2000-03-01",
  },
  {
    // Sleeper keeps the suffix in `search_full_name`; our normalizer drops it.
    playerId: 3,
    searchName: "kennethwalkeriii",
    fullName: "Kenneth Walker III",
    position: "RB",
    nflTeam: "SEA",
    birthDate: "2000-10-25",
  },
  {
    playerId: 4,
    searchName: "",
    fullName: "San Francisco 49ers",
    position: "DEF",
    nflTeam: "SF",
    birthDate: null,
  },
  {
    playerId: 5,
    searchName: "jacksonvillejaguars",
    fullName: "Jacksonville Jaguars",
    position: "DEF",
    nflTeam: "JAX",
    birthDate: null,
  },
  {
    playerId: 6,
    searchName: "michaelthomas",
    fullName: "Michael Thomas",
    position: "WR",
    nflTeam: "NO",
    birthDate: "1993-03-03",
  },
  {
    playerId: 7,
    searchName: "michaelthomas",
    fullName: "Michael Thomas",
    position: "WR",
    nflTeam: "HOU",
    birthDate: "1998-01-01",
  },
  {
    playerId: 8,
    searchName: "christopherjonathanwilliams",
    fullName: "Christopher Jonathan Williams",
    position: "TE",
    nflTeam: "DAL",
    birthDate: null,
  },
  {
    playerId: 9,
    searchName: "jaydendaniels",
    fullName: "Jayden Daniels",
    position: "QB",
    nflTeam: "WAS",
    birthDate: "2000-12-18",
  },
];

const index = new CandidateIndex(CANDIDATES);

function target(
  name: string,
  position: string | null,
  nflTeam: string | null,
  extra: { isDefense?: boolean; birthDate?: string | null } = {},
) {
  return { sourceId: "y", name, position, nflTeam, ...extra };
}

describe("trigramSimilarity", () => {
  it("scores identical strings 1 and disjoint strings low", () => {
    expect(trigramSimilarity("joshallen", "joshallen")).toBe(1);
    expect(trigramSimilarity("joshallen", "bijanrobinson")).toBeLessThan(0.1);
  });

  it("scores nothing against an empty string", () => {
    expect(trigramSimilarity("", "joshallen")).toBe(0);
  });
});

describe("normalizeTeam / normalizePosition", () => {
  it("maps the abbreviations the sources spell differently", () => {
    expect(normalizeTeam("Jac")).toBe("JAX");
    expect(normalizeTeam("wsh")).toBe("WAS");
    expect(normalizeTeam("FA")).toBeNull();
  });

  it("takes the primary position from Yahoo's multi-position field", () => {
    expect(normalizePosition("RB,WR")).toBe("RB");
    expect(normalizePosition("D/ST")).toBe("DEF");
  });
});

describe("CandidateIndex.match", () => {
  it("matches on name + position + team", () => {
    expect(index.match(target("Josh Allen", "QB", "Buf"))).toEqual({
      playerId: 1,
      method: "name_position_team",
      confidence: 0.95,
    });
  });

  it("normalizes punctuation the way Sleeper does", () => {
    expect(index.match(target("Ja'Marr Chase", "WR", "CIN"))?.playerId).toBe(2);
  });

  it("matches through a suffix Sleeper keeps and we drop", () => {
    expect(index.match(target("Kenneth Walker III", "RB", "SEA"))).toMatchObject({
      playerId: 3,
      method: "name_position_team",
    });
  });

  it("falls back to name + position when the team has changed", () => {
    expect(index.match(target("Ja'Marr Chase", "WR", "PHI"))).toEqual({
      playerId: 2,
      method: "name_position",
      confidence: 0.9,
    });
  });

  it("resolves a defense by team abbreviation, aliases included", () => {
    expect(
      index.match(target("San Francisco", "DEF", "SF", { isDefense: true })),
    ).toMatchObject({ playerId: 4, method: "team_defense" });

    expect(
      index.match(target("Jacksonville", "DEF", "Jac", { isDefense: true })),
    ).toMatchObject({ playerId: 5 });
  });

  it("refuses a defense whose team it does not know", () => {
    expect(
      index.match(target("Toronto", "DEF", "TOR", { isDefense: true })),
    ).toBeNull();
  });

  it("never crosses positions", () => {
    expect(index.match(target("Josh Allen", "WR", "BUF"))).toBeNull();
  });

  it("leaves an ambiguous name unmatched rather than guessing", () => {
    expect(index.match(target("Michael Thomas", "WR", "SEA"))).toBeNull();
  });

  it("breaks a tie on team, then on birth date", () => {
    expect(index.match(target("Michael Thomas", "WR", "NO"))?.playerId).toBe(6);
    expect(
      index.match(
        target("Michael Thomas", "WR", null, { birthDate: "1998-01-01" }),
      )?.playerId,
    ).toBe(7);
  });

  it("fuzzy-matches a near-identical name", () => {
    const match = index.match(
      target("Christopher Jonathan William", "TE", "DAL"),
    );
    expect(match?.playerId).toBe(8);
    expect(match?.method).toBe("fuzzy");
    expect(match?.confidence).toBeGreaterThanOrEqual(0.88);
  });

  it("refuses a near-miss below the threshold", () => {
    // 0.80 similarity. Conservative on purpose: a wrong match corrupts every
    // trade verdict the player touches, an unmatched one is one click away.
    expect(index.match(target("Jayden Daniel", "QB", "WAS"))).toBeNull();
  });
});

describe("CandidateIndex.suggest", () => {
  it("puts the near-miss the ladder refused at the top of the list", () => {
    const [first] = index.suggest(target("Jayden Daniel", "QB", "WAS"));
    expect(first.playerId).toBe(9);
  });

  it("suggests both sides of an ambiguous name", () => {
    const ids = index
      .suggest(target("Michael Thomas", "WR", "SEA"), 2)
      .map((candidate) => candidate.playerId);
    expect(ids).toContain(6);
    expect(ids).toContain(7);
  });
});

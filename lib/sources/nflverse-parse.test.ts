import { describe, expect, it } from "vitest";

import { parseWeeklyScoring, type PositionScoring } from "./nflverse-parse";

const HEADER =
  "player_id,position,season,week,season_type,team,opponent_team,fantasy_points,fantasy_points_ppr";

const line = (
  values: Partial<{
    id: string;
    position: string;
    week: number;
    seasonType: string;
    team: string;
    opponent: string;
    points: number;
    ppr: number;
  }> = {},
) => {
  const row = {
    id: "00-0000001",
    position: "WR",
    week: 1,
    seasonType: "REG",
    team: "KC",
    opponent: "BUF",
    points: 10,
    ppr: 16,
    ...values,
  };
  return `${row.id},${row.position},2025,${row.week},${row.seasonType},${row.team},${row.opponent},${row.points},${row.ppr}`;
};

const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

const find = (
  rows: PositionScoring[],
  team: string,
  position: string,
  side: "for" | "against",
) => rows.find((row) => row.team === team && row.position === position && row.side === side);

describe("parseWeeklyScoring", () => {
  it("credits the offense and debits the defense from one line", () => {
    const rows = parseWeeklyScoring(csv(line()));

    expect(find(rows, "KC", "WR", "for")).toMatchObject({
      games: 1,
      pointsStd: 10,
      receptions: 6,
    });
    expect(find(rows, "BUF", "WR", "against")).toMatchObject({
      games: 1,
      pointsStd: 10,
      receptions: 6,
    });
  });

  it("counts games by week, not by player", () => {
    const rows = parseWeeklyScoring(
      csv(
        line({ id: "a" }),
        line({ id: "b", points: 4, ppr: 7 }),
        line({ id: "a", week: 2, points: 8, ppr: 11 }),
      ),
    );

    // Two receivers in week 1 and one in week 2 is two games, not three.
    expect(find(rows, "KC", "WR", "for")).toMatchObject({
      games: 2,
      pointsStd: 22,
      receptions: 12,
    });
  });

  it("reads receptions off the gap between the two scoring columns", () => {
    const rows = parseWeeklyScoring(csv(line({ points: 12.4, ppr: 12.4 })));
    // A rushing quarterback catches nothing, so the two columns agree.
    expect(find(rows, "KC", "WR", "for")?.receptions).toBe(0);
  });

  it("ignores the postseason and the positions no defense is graded on", () => {
    const rows = parseWeeklyScoring(
      csv(
        line({ seasonType: "POST" }),
        line({ position: "K" }),
        line({ position: "CB" }),
        line({ week: 0 }),
      ),
    );

    expect(rows).toEqual([]);
  });

  it("normalizes team abbreviations on both sides of the ball", () => {
    const rows = parseWeeklyScoring(csv(line({ team: "LA", opponent: "JAC" })));

    expect(find(rows, "LAR", "WR", "for")).toBeDefined();
    expect(find(rows, "JAX", "WR", "against")).toBeDefined();
  });

  it("reads columns by name rather than by position in the file", () => {
    const reordered = [
      "week,fantasy_points_ppr,opponent_team,position,team,fantasy_points,season_type",
      "3,16,BUF,WR,KC,10,REG",
    ].join("\n");

    expect(find(parseWeeklyScoring(reordered), "BUF", "WR", "against")).toMatchObject({
      games: 1,
      pointsStd: 10,
      receptions: 6,
    });
  });
});

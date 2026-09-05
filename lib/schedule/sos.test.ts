import { describe, expect, it } from "vitest";

import {
  averageReading,
  defenseBoard,
  findReading,
  gradeKey,
  PRIOR_SEASON_WEIGHT,
  scheduleStrength,
  tierOf,
  weekWindow,
  windowsFor,
  type ScheduleRow,
  type ScoringRow,
} from "./sos";

const SEASON = 2026;
const PRIOR = 2025;

/** Four teams is enough to have a spread, a rank and a tier. */
const TEAMS = ["AAA", "BBB", "CCC", "DDD"];

function allowed(
  team: string,
  {
    position = "WR",
    season = PRIOR,
    games = 17,
    pointsStd = 170,
    receptions = 0,
  }: Partial<Omit<ScoringRow, "team" | "side">> = {},
): ScoringRow {
  return { season, team, position, side: "against", games, pointsStd, receptions };
}

/** A round-robin: every team plays every other once, in weeks 1 to 3. */
function roundRobin(): ScheduleRow[] {
  const pairs: [number, number][][] = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];

  return pairs.flatMap((week, index) =>
    week.flatMap(([home, away]) => [
      { week: index + 1, team: TEAMS[home], opponent: TEAMS[away], isHome: true },
      { week: index + 1, team: TEAMS[away], opponent: TEAMS[home], isHome: false },
    ]),
  );
}

describe("defenseBoard", () => {
  it("scores a stored total with the league's own PPR modifier", () => {
    const rows = [
      allowed("AAA", { season: SEASON, games: 1, pointsStd: 10, receptions: 6 }),
    ];

    const half = defenseBoard(rows, { season: SEASON, priorSeason: PRIOR, ppr: 0.5 });
    const full = defenseBoard(rows, { season: SEASON, priorSeason: PRIOR, ppr: 1 });

    expect(half.grades.get(gradeKey("AAA", "WR"))?.ppg).toBe(13);
    expect(full.grades.get(gradeKey("AAA", "WR"))?.ppg).toBe(16);
  });

  it("ranks the softest defense first, because that is the one to face", () => {
    const board = defenseBoard(
      [
        allowed("AAA", { pointsStd: 340 }),
        allowed("BBB", { pointsStd: 170 }),
        allowed("CCC", { pointsStd: 255 }),
      ],
      { season: SEASON, priorSeason: PRIOR, ppr: 1 },
    );

    expect(board.grades.get(gradeKey("AAA", "WR"))?.rank).toBe(1);
    expect(board.grades.get(gradeKey("CCC", "WR"))?.rank).toBe(2);
    expect(board.grades.get(gradeKey("BBB", "WR"))?.rank).toBe(3);
    // Positive z is a soft defense, on both readings.
    expect(board.grades.get(gradeKey("AAA", "WR"))!.z).toBeGreaterThan(0);
    expect(board.grades.get(gradeKey("BBB", "WR"))!.z).toBeLessThan(0);
  });

  it("pools points and games rather than averaging two rates", () => {
    // One live game at 30 against seventeen prior at 10. Averaging the rates
    // would say 20; pooling says the one game barely moves the season.
    const board = defenseBoard(
      [
        allowed("AAA", { season: SEASON, games: 1, pointsStd: 30 }),
        allowed("AAA", { season: PRIOR, games: 17, pointsStd: 170 }),
      ],
      { season: SEASON, priorSeason: PRIOR, ppr: 1 },
    );

    const expected =
      (30 + PRIOR_SEASON_WEIGHT * 170) / (1 + PRIOR_SEASON_WEIGHT * 17);
    expect(board.grades.get(gradeKey("AAA", "WR"))?.ppg).toBeCloseTo(expected, 6);
    expect(board.liveGames).toBe(1);
    expect(board.seasons).toEqual([SEASON, PRIOR]);
  });

  it("ignores a season nobody asked for, and a row with no games behind it", () => {
    const board = defenseBoard(
      [
        allowed("AAA", { season: 2019 }),
        allowed("BBB", { games: 0, pointsStd: 0 }),
      ],
      { season: SEASON, priorSeason: PRIOR, ppr: 1 },
    );

    expect(board.grades.size).toBe(0);
  });

  it("leaves a one-team league at the mean rather than dividing by zero", () => {
    const board = defenseBoard([allowed("AAA")], {
      season: SEASON,
      priorSeason: PRIOR,
      ppr: 1,
    });

    expect(board.grades.get(gradeKey("AAA", "WR"))?.z).toBe(0);
  });
});

describe("scheduleStrength", () => {
  const board = defenseBoard(
    [
      allowed("AAA", { pointsStd: 170 }),
      allowed("BBB", { pointsStd: 204 }),
      allowed("CCC", { pointsStd: 238 }),
      allowed("DDD", { pointsStd: 272 }),
    ],
    { season: SEASON, priorSeason: PRIOR, ppr: 1 },
  );

  const readings = scheduleStrength(roundRobin(), board, weekWindow(1, 3));

  it("gives the team that misses the softest opponent the hardest slate", () => {
    // DDD is the softest defense, so whoever does NOT have to face itself
    // benefits. Every team plays the other three, so the reading is the mean
    // of the three defenses each faces.
    const easiest = readings.get(gradeKey("AAA", "WR"))!;
    const hardest = readings.get(gradeKey("DDD", "WR"))!;

    expect(easiest.rank).toBe(1);
    expect(easiest.pointsPerGame).toBeGreaterThan(0);
    expect(hardest.rank).toBe(4);
    expect(hardest.pointsPerGame).toBeLessThan(0);
    expect(hardest.outOf).toBe(4);
  });

  it("counts a bye rather than averaging it away", () => {
    const slate = roundRobin().filter(
      (row) => !(row.week === 2 && (row.team === "AAA" || row.opponent === "AAA")),
    );

    const reading = scheduleStrength(slate, board, weekWindow(1, 3)).get(
      gradeKey("AAA", "WR"),
    )!;

    expect(reading.games).toBe(2);
    expect(reading.byes).toEqual([2]);
    expect(reading.weeks).toHaveLength(3);
    expect(reading.weeks[1]).toMatchObject({ week: 2, opponent: null, z: null });
  });

  it("names the opponent and the side of the field for every week", () => {
    const reading = readings.get(gradeKey("AAA", "WR"))!;

    expect(reading.weeks.map((week) => week.opponent)).toEqual([
      "BBB",
      "CCC",
      "DDD",
    ]);
    expect(reading.weeks.map((week) => week.isHome)).toEqual([true, true, true]);
    // Rank 1 is the softest defense, so AAA's week 3 opponent is it.
    expect(reading.weeks[2].opponentRank).toBe(1);
  });

  it("reads the same slate differently over a different window", () => {
    const week3 = scheduleStrength(roundRobin(), board, weekWindow(3, 3));

    expect(week3.get(gradeKey("AAA", "WR"))!.games).toBe(1);
    // In week 3 alone, AAA faces the softest defense in the league.
    expect(week3.get(gradeKey("AAA", "WR"))!.rank).toBe(1);
    // BBB faces CCC, and DDD faces AAA -- the toughest.
    expect(week3.get(gradeKey("DDD", "WR"))!.rank).toBe(4);
  });

  it("has no reading for a team whose window holds no graded opponent", () => {
    const empty = scheduleStrength(roundRobin(), board, weekWindow(9, 10));
    expect(empty.size).toBe(0);
  });
});

describe("tierOf", () => {
  it("splits a 32-team board into thirds", () => {
    expect(tierOf(1, 32)).toBe("easy");
    expect(tierOf(10, 32)).toBe("easy");
    expect(tierOf(11, 32)).toBe("even");
    expect(tierOf(22, 32)).toBe("even");
    expect(tierOf(23, 32)).toBe("hard");
    expect(tierOf(32, 32)).toBe("hard");
  });

  it("calls a board too small to have thirds level", () => {
    expect(tierOf(1, 2)).toBe("even");
  });
});

describe("weekWindow", () => {
  it("is inclusive and clamped to the NFL's own eighteen", () => {
    expect(weekWindow(15, 17)).toEqual([15, 16, 17]);
    expect(weekWindow(0, 2)).toEqual([1, 2]);
    expect(weekWindow(17, 40)).toEqual([17, 18]);
    // A window that ran backwards is one week, not none.
    expect(weekWindow(5, 3)).toEqual([5]);
  });
});

describe("findReading", () => {
  const board = defenseBoard(
    [allowed("AAA"), allowed("BBB", { pointsStd: 204 })],
    { season: SEASON, priorSeason: PRIOR, ppr: 1 },
  );
  const readings = scheduleStrength(
    [
      { week: 1, team: "AAA", opponent: "BBB", isHome: true },
      { week: 1, team: "BBB", opponent: "AAA", isHome: false },
    ],
    board,
    [1],
  );

  it("matches a lower-case position", () => {
    expect(findReading(readings, "AAA", "wr")).not.toBeNull();
  });

  it("has nothing for a free agent, a kicker or a defense", () => {
    expect(findReading(readings, null, "WR")).toBeNull();
    expect(findReading(readings, "AAA", "K")).toBeNull();
    expect(findReading(readings, "AAA", "DEF")).toBeNull();
  });
});

describe("averageReading", () => {
  const reading = (pointsPerGame: number) =>
    ({ pointsPerGame }) as never;

  it("averages the graded starters and counts them", () => {
    expect(averageReading([reading(2), reading(-1), null])).toEqual({
      pointsPerGame: 0.5,
      graded: 2,
    });
  });

  it("is null rather than zero when nothing is graded", () => {
    expect(averageReading([null, null])).toBeNull();
  });
});

describe("windowsFor", () => {
  const clock = {
    season: 2026,
    priorSeason: 2025,
    ppr: 1,
    currentWeek: null,
    startWeek: 1,
    endWeek: 17,
  };

  it("reads rest of season from the live week, not from week one", () => {
    expect(windowsFor({ ...clock, currentWeek: 9 }).ros).toEqual([
      9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
  });

  it("puts the whole slate ahead before kickoff", () => {
    expect(windowsFor(clock).ros).toHaveLength(17);
  });

  it("takes the playoffs as the last three weeks the league plays", () => {
    expect(windowsFor(clock).playoffs).toEqual([15, 16, 17]);
    // A league that finishes in week 14 has its own three.
    expect(windowsFor({ ...clock, endWeek: 14 }).playoffs).toEqual([12, 13, 14]);
  });

  it("does not run the window backwards on a league already past its end", () => {
    const windows = windowsFor({ ...clock, currentWeek: 17, endWeek: 14 });
    expect(windows.ros).toEqual([14]);
  });
});

/**
 * Hand-built fixtures in ESPN's raw v3 shape — integer slot ids, integer pro
 * team ids, `playerPoolEntry` wrappers and all. They mirror the structure of
 * `?view=mSettings&view=mTeam`, `?view=mRoster` and `?view=kona_player_info`.
 */

export const LEAGUE_ID = "123456";
export const SEASON = 2026;

export const MY_SWID = "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}";
const OTHER_SWID = "{11111111-2222-3333-4444-555555555555}";

/** A full-PPR superflex lineup: QB, 2RB, 2WR, TE, FLEX, OP, K, D/ST, 6 BN, IR. */
export const LINEUP_SLOT_COUNTS: Record<string, number> = {
  "0": 1,
  "2": 2,
  "4": 2,
  "6": 1,
  "7": 1,
  "16": 1,
  "17": 1,
  "20": 6,
  "21": 1,
  "23": 1,
};

export function settingsPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: Number(LEAGUE_ID),
    seasonId: SEASON,
    scoringPeriodId: 3,
    status: {
      currentMatchupPeriod: 3,
      firstScoringPeriod: 1,
      finalScoringPeriod: 17,
      latestScoringPeriod: 3,
      isActive: true,
    },
    settings: {
      name: "The Ditka Memorial",
      size: 2,
      rosterSettings: { lineupSlotCounts: LINEUP_SLOT_COUNTS },
      scoringSettings: {
        scoringType: "H2H_POINTS",
        scoringItems: [
          { statId: 42, points: 0.1 },
          { statId: 53, points: 1 },
        ],
      },
      scheduleSettings: { matchupPeriodCount: 14, playoffMatchupPeriodLength: 1 },
      draftSettings: { keeperCount: 0 },
      acquisitionSettings: { acquisitionBudget: 100 },
    },
    members: [
      { id: MY_SWID, displayName: "you", firstName: "Ava", lastName: "Ng" },
      { id: OTHER_SWID, displayName: "rival", firstName: "Bo", lastName: "Ito" },
    ],
    teams: [
      {
        id: 1,
        name: "Sunday Scaries",
        abbrev: "SUN",
        logo: "https://example.test/1.png",
        owners: [MY_SWID],
        playoffSeed: 2,
        rankCalculatedFinal: 0,
        waiverRank: 5,
        record: {
          overall: {
            wins: 2,
            losses: 1,
            ties: 0,
            pointsFor: 310.5,
            pointsAgainst: 288.25,
          },
        },
        transactionCounter: {
          acquisitions: 4,
          trades: 1,
          acquisitionBudgetSpent: 27,
        },
      },
      {
        id: 2,
        // Older seasons send the two halves rather than a `name`.
        location: "Gridiron",
        nickname: "Goblins",
        abbrev: "GOB",
        owners: [OTHER_SWID],
        playoffSeed: 1,
        waiverRank: 1,
        record: {
          overall: { wins: 3, losses: 0, ties: 0, pointsFor: 355, pointsAgainst: 270 },
        },
        transactionCounter: { acquisitions: 1, trades: 0, acquisitionBudgetSpent: 0 },
      },
    ],
    ...overrides,
  };
}

function entry(
  playerId: number,
  fullName: string,
  positionId: number,
  proTeamId: number,
  lineupSlotId: number,
  injuryStatus = "ACTIVE",
) {
  return {
    playerId,
    lineupSlotId,
    playerPoolEntry: {
      player: {
        id: playerId,
        fullName,
        defaultPositionId: positionId,
        proTeamId,
        injuryStatus,
      },
    },
  };
}

export function rosterPayload() {
  return {
    id: Number(LEAGUE_ID),
    seasonId: SEASON,
    teams: [
      {
        id: 1,
        name: "Sunday Scaries",
        roster: {
          entries: [
            entry(3139477, "Patrick Mahomes", 1, 12, 0),
            entry(4362628, "Ja'Marr Chase", 3, 4, 4, "QUESTIONABLE"),
            entry(3117251, "Christian McCaffrey", 2, 25, 20, "INJURY_RESERVE"),
            entry(-16028, "Commanders D/ST", 16, 28, 16),
          ],
        },
      },
      {
        id: 2,
        location: "Gridiron",
        nickname: "Goblins",
        roster: { entries: [entry(4241457, "Justin Jefferson", 3, 16, 23)] },
      },
    ],
  };
}

export function freeAgentPayload() {
  return {
    players: [
      {
        id: 4429795,
        onTeamId: 0,
        player: {
          id: 4429795,
          fullName: "Rome Odunze",
          defaultPositionId: 3,
          proTeamId: 3,
          injuryStatus: "ACTIVE",
        },
      },
      {
        // ESPN's availability filter is not always obeyed; a rostered player
        // that slips through is not a free agent.
        id: 4362628,
        onTeamId: 1,
        player: {
          id: 4362628,
          fullName: "Ja'Marr Chase",
          defaultPositionId: 3,
          proTeamId: 4,
          injuryStatus: "ACTIVE",
        },
      },
    ],
  };
}

export function matchupPayload() {
  return {
    id: Number(LEAGUE_ID),
    seasonId: SEASON,
    schedule: [
      {
        matchupPeriodId: 1,
        winner: "HOME",
        playoffTierType: "NONE",
        home: { teamId: 1, totalPoints: 110.5 },
        away: { teamId: 2, totalPoints: 99.25 },
      },
      {
        matchupPeriodId: 2,
        winner: "UNDECIDED",
        playoffTierType: "NONE",
        home: { teamId: 2, totalPoints: 0 },
        away: { teamId: 1, totalPoints: 0 },
      },
      {
        matchupPeriodId: 15,
        winner: "UNDECIDED",
        playoffTierType: "WINNERS_BRACKET",
        home: { teamId: 1, totalPoints: 0 },
        away: null,
      },
    ],
  };
}

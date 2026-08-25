/**
 * Hand-built fixtures in Yahoo's raw `format=json` shape — counted collections,
 * fragment arrays, stringified numbers and all. They mirror the structure
 * documented for `users;use_login=1/games/leagues` and
 * `league;out=settings,standings,teams`.
 */

type Any = Record<string, unknown>;

/** Yahoo's counted-collection wrapper: `{"0": x, "1": y, "count": 2}`. */
export function counted(items: unknown[]): Any {
  const out: Any = {};
  items.forEach((item, index) => {
    out[String(index)] = item;
  });
  out.count = items.length;
  return out;
}

export const LEAGUE_KEY = "461.l.123456";

const TEAM_NAMES = [
  "Sunday Scaries",
  "Gridiron Goblins",
  "Purple Reign",
  "Check Down Charlie",
  "Air Raid Sirens",
  "Bench Warmers",
  "Trap Game Tony",
  "Hurts So Good",
  "Zero RB Zealots",
  "The Waiver Wire",
  "Fourth and Long",
  "Play Action Heroes",
];

function team(index: number) {
  const teamId = index + 1;
  const isUsers = index === 3;

  const fragments: unknown[] = [
    { team_key: `${LEAGUE_KEY}.t.${teamId}` },
    { team_id: String(teamId) },
    { name: TEAM_NAMES[index] },
    { url: `https://football.fantasysports.yahoo.com/f1/123456/${teamId}` },
    {
      team_logos:
        index === 5
          ? [{ team_logo: { size: "large", url: "" } }]
          : [
              {
                team_logo: {
                  size: "large",
                  url: `https://s.yimg.com/logo/${teamId}.png`,
                },
              },
            ],
    },
    { waiver_priority: teamId },
    { faab_balance: String(100 - index) },
    { number_of_moves: String(index) },
    { number_of_trades: index === 2 ? "2" : "0" },
    { league_scoring_type: "head" },
    {
      managers:
        index === 7
          ? [
              { manager: { manager_id: "8", nickname: "Dana", guid: "G8" } },
              { manager: { manager_id: "9", nickname: "Sam", guid: "G9" } },
            ]
          : index === 9
            ? [{ manager: { manager_id: "10", nickname: "--hidden--", guid: "G10" } }]
            : [
                {
                  manager: {
                    manager_id: String(teamId),
                    nickname: `Manager ${teamId}`,
                    guid: `G${teamId}`,
                    ...(isUsers ? { is_current_login: "1" } : {}),
                  },
                },
              ],
    },
  ];

  if (isUsers) {
    fragments.splice(4, 0, { is_owned_by_current_login: 1 });
  }

  return {
    team: [
      fragments,
      { team_points: { coverage_type: "week", week: "3", total: "0.00" } },
    ],
  };
}

function standingsTeam(index: number) {
  const base = team(index).team;
  return {
    team: [
      ...base,
      {
        team_standings: {
          rank: index + 1,
          playoff_seed: index < 6 ? String(index + 1) : "",
          outcome_totals: {
            wins: String(12 - index),
            losses: String(index),
            ties: "0",
            percentage: ".500",
          },
          streak: { type: "win", value: "2" },
          points_for: String(1500.5 - index * 40),
          points_against: String(1200.25 + index * 10),
        },
      },
    ],
  };
}

const ROSTER_POSITIONS = [
  { position: "QB", position_type: "O", count: 1, is_starting_position: 1 },
  { position: "WR", position_type: "O", count: 2, is_starting_position: 1 },
  { position: "RB", position_type: "O", count: 2, is_starting_position: 1 },
  { position: "TE", position_type: "O", count: 1, is_starting_position: 1 },
  { position: "W/R/T", position_type: "O", count: 1, is_starting_position: 1 },
  { position: "K", position_type: "K", count: 1, is_starting_position: 1 },
  { position: "DEF", position_type: "DT", count: 1, is_starting_position: 1 },
  { position: "BN", count: 6, is_starting_position: 0 },
  { position: "IR", count: 2, is_starting_position: 0 },
];

export function settings({ superflex = false, keeper = false } = {}) {
  const positions = superflex
    ? [
        ...ROSTER_POSITIONS.slice(0, 7),
        {
          position: "Q/W/R/T",
          position_type: "O",
          count: 1,
          is_starting_position: 1,
        },
        ...ROSTER_POSITIONS.slice(7),
      ]
    : ROSTER_POSITIONS;

  return {
    settings: [
      {
        draft_type: "live",
        is_auction_draft: "0",
        scoring_type: "head",
        uses_playoff: "1",
        playoff_start_week: "15",
        num_playoff_teams: "6",
        max_teams: "12",
        uses_faab: "1",
        ...(keeper ? { is_keeper: "1", keeper_deadline: "1756000000" } : {}),
        roster_positions: positions.map((roster_position) => ({
          roster_position,
        })),
        stat_modifiers: {
          stats: [
            { stat: { stat_id: 4, value: "0.04" } },
            { stat: { stat_id: 9, value: "6" } },
            { stat: { stat_id: 11, value: "0.5" } },
            { stat: { stat_id: 12, value: "6" } },
          ],
        },
      },
    ],
  };
}

export function leagueResponse(options?: { superflex?: boolean; keeper?: boolean }) {
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      league: [
        {
          league_key: LEAGUE_KEY,
          league_id: "123456",
          name: "Sunday Funday Dynasty Club",
          url: "https://football.fantasysports.yahoo.com/f1/123456",
          logo_url: "https://s.yimg.com/logo/league.png",
          draft_status: "postdraft",
          num_teams: 12,
          edit_key: "3",
          weekly_deadline: "",
          scoring_type: "head",
          league_type: "private",
          current_week: 3,
          start_week: "1",
          end_week: "17",
          game_code: "nfl",
          season: "2026",
        },
        settings(options),
        {
          standings: [
            { teams: counted(TEAM_NAMES.map((_, index) => standingsTeam(index))) },
          ],
        },
        { teams: counted(TEAM_NAMES.map((_, index) => team(index))) },
      ],
    },
  };
}

export function discoveryResponse() {
  return {
    fantasy_content: {
      users: counted([
        {
          user: [
            { guid: "USERGUID123" },
            {
              games: counted([
                {
                  game: [
                    {
                      game_key: "461",
                      game_id: "461",
                      name: "Football",
                      code: "nfl",
                      season: "2026",
                    },
                    {
                      leagues: counted([
                        {
                          league: [
                            {
                              league_key: LEAGUE_KEY,
                              league_id: "123456",
                              name: "Sunday Funday Dynasty Club",
                              url: "https://football.fantasysports.yahoo.com/f1/123456",
                              logo_url: "https://s.yimg.com/logo/league.png",
                              draft_status: "postdraft",
                              num_teams: 12,
                              scoring_type: "head",
                              season: "2026",
                            },
                          ],
                        },
                        {
                          league: [
                            {
                              league_key: "461.l.999",
                              league_id: "999",
                              name: "Work League",
                              logo_url: false,
                              num_teams: "10",
                              scoring_type: "headpoint",
                              season: "2026",
                            },
                          ],
                        },
                      ]),
                    },
                  ],
                },
              ]),
            },
          ],
        },
      ]),
    },
  };
}

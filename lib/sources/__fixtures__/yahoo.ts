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

// ---------------------------------------------------------------------------
// rosters and free agents
// ---------------------------------------------------------------------------

type PlayerSpec = {
  id: number;
  name: string;
  pos: string;
  team: string;
  slot?: string;
  status?: string;
};

function positionType(pos: string) {
  if (pos === "DEF") return "DT";
  return pos === "K" ? "K" : "O";
}

function playerNode({ id, name, pos, team, slot, status }: PlayerSpec) {
  const [first, ...rest] = name.split(" ");

  const fragments: unknown[] = [
    { player_key: `461.p.${id}` },
    { player_id: String(id) },
    {
      name: {
        full: name,
        first,
        last: rest.join(" "),
        ascii_first: first,
        ascii_last: rest.join(" "),
      },
    },
    { editorial_team_abbr: team },
    { bye_weeks: { week: "10" } },
    { uniform_number: "" },
    { display_position: pos },
    { position_type: positionType(pos) },
    { eligible_positions: [{ position: pos }] },
    { image_url: `https://s.yimg.com/player/${id}.png` },
  ];

  if (status) fragments.push({ status }, { injury_note: "Knee" });

  const node: unknown[] = [fragments];
  if (slot) {
    node.push({
      selected_position: [
        { coverage_type: "week" },
        { week: "3" },
        { position: slot },
        { is_flex: 0 },
      ],
    });
  }

  return { player: node };
}

const ROSTERS: PlayerSpec[][] = [
  [
    { id: 30123, name: "Josh Allen", pos: "QB", team: "Buf", slot: "QB" },
    { id: 31002, name: "Ja'Marr Chase", pos: "WR", team: "Cin", slot: "WR" },
    { id: 40001, name: "Bijan Robinson", pos: "RB", team: "Atl", slot: "BN" },
    { id: 100024, name: "San Francisco", pos: "DEF", team: "SF", slot: "DEF" },
  ],
  [
    { id: 33333, name: "Kenneth Walker III", pos: "RB", team: "Sea", slot: "RB" },
    {
      id: 44444,
      name: "Brock Bowers",
      pos: "TE",
      team: "LV",
      slot: "TE",
      status: "Q",
    },
    { id: 55555, name: "Justin Tucker", pos: "K", team: "Bal", slot: "K" },
  ],
];

/** A `league/{key}/teams;out=roster` payload for two teams. */
export function rosterResponse() {
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY, name: "Sunday Funday Dynasty Club" },
        {
          teams: counted(
            ROSTERS.map((players, index) => ({
              team: [
                [
                  { team_key: `${LEAGUE_KEY}.t.${index + 1}` },
                  { team_id: String(index + 1) },
                  { name: TEAM_NAMES[index] },
                ],
                {
                  roster: {
                    "0": { players: counted(players.map(playerNode)) },
                    coverage_type: "week",
                    week: "3",
                    is_editable: 1,
                  },
                },
              ],
            })),
          ),
        },
      ],
    },
  };
}

const FREE_AGENTS: PlayerSpec[] = [
  { id: 66666, name: "Rome Odunze", pos: "WR", team: "Chi" },
  {
    id: 77777,
    name: "Jonathon Brooks",
    pos: "RB",
    team: "Car",
    status: "IR",
  },
];

/** A `league/{key}/players;status=A` page. */
export function freeAgentsResponse() {
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY, name: "Sunday Funday Dynasty Club" },
        { players: counted(FREE_AGENTS.map(playerNode)) },
      ],
    },
  };
}

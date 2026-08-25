/**
 * Pure parsers for Yahoo Fantasy payloads. No transport, no `server-only`, no
 * path aliases — so they can be exercised against recorded fixtures in tests,
 * which is the only way to check this code without a live Yahoo account.
 */
import { z } from "zod";

import {
  collection,
  isPlainObject,
  toArray,
  yahooBool,
  type Plain,
} from "./yahoo-json";

/** Yahoo sends `""`/`false` where it means "absent". */
const optionalString = z.preprocess(
  (value) => (value === "" || value === false || value === null ? undefined : value),
  z.coerce.string().optional(),
);
const optionalNumber = z.preprocess(
  (value) => (value === "" || value === false || value === null ? undefined : value),
  z.coerce.number().optional(),
);

export class YahooParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YahooParseError";
  }
}

// ---------------------------------------------------------------------------
// league discovery
// ---------------------------------------------------------------------------

const DiscoveredLeagueSchema = z.object({
  league_key: z.string(),
  name: z.string(),
  season: z.coerce.number(),
  num_teams: optionalNumber,
  scoring_type: optionalString,
  logo_url: optionalString,
  url: optionalString,
  draft_status: optionalString,
});

export type DiscoveredLeague = {
  leagueKey: string;
  name: string;
  season: number;
  numTeams: number | null;
  scoringType: string | null;
  logoUrl: string | null;
  url: string | null;
  draftStatus: string | null;
};

export type YahooDiscovery = {
  guid: string | null;
  leagues: DiscoveredLeague[];
};

/** Every NFL league the signed-in Yahoo account belongs to, from a users payload. */
export function parseDiscovery(content: Plain): YahooDiscovery {
  const users = collection(content.users, "user");
  const leagues: DiscoveredLeague[] = [];
  let guid: string | null = null;

  for (const user of users) {
    guid ??= typeof user.guid === "string" ? user.guid : null;

    for (const game of collection(user.games, "game")) {
      for (const raw of collection(game.leagues, "league")) {
        const parsed = DiscoveredLeagueSchema.safeParse(raw);
        if (!parsed.success) continue;

        leagues.push({
          leagueKey: parsed.data.league_key,
          name: parsed.data.name,
          season: parsed.data.season,
          numTeams: parsed.data.num_teams ?? null,
          scoringType: parsed.data.scoring_type ?? null,
          logoUrl: parsed.data.logo_url ?? null,
          url: parsed.data.url ?? null,
          draftStatus: parsed.data.draft_status ?? null,
        });
      }
    }
  }

  leagues.sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
  return { guid, leagues };
}

// ---------------------------------------------------------------------------
// league import
// ---------------------------------------------------------------------------

const LeagueMetaSchema = z.object({
  league_key: z.string(),
  name: z.string(),
  season: z.coerce.number(),
  num_teams: optionalNumber,
  scoring_type: optionalString,
  current_week: optionalNumber,
  start_week: optionalNumber,
  end_week: optionalNumber,
  logo_url: optionalString,
  url: optionalString,
  is_finished: optionalNumber,
});

const RosterPositionSchema = z.object({
  position: z.string(),
  position_type: optionalString,
  count: z.coerce.number(),
  is_starting_position: optionalNumber,
});

export type RosterSlot = {
  position: string;
  positionType: string | null;
  count: number;
  isStarting: boolean;
};

export type LeagueImport = {
  leagueKey: string;
  gameKey: string;
  name: string;
  season: number;
  numTeams: number | null;
  scoringType: string | null;
  ppr: number;
  numQbs: number;
  rosterSlots: RosterSlot[];
  isDynasty: boolean;
  currentWeek: number | null;
  startWeek: number | null;
  endWeek: number | null;
  logoUrl: string | null;
  url: string | null;
  isFinished: boolean;
};

export type TeamImport = {
  teamKey: string;
  teamId: number | null;
  name: string;
  managerName: string | null;
  logoUrl: string | null;
  isUsersTeam: boolean;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
  rank: number | null;
  playoffSeed: number | null;
  waiverPriority: number | null;
  faabBalance: number | null;
  numberOfMoves: number | null;
  numberOfTrades: number | null;
};

/** Yahoo stat id 11 is Receptions — the PPR value in one number (§1.2). */
const RECEPTIONS_STAT_ID = 11;

/** Positions that let a QB start, which is what makes a league superflex. */
const SUPERFLEX_POSITIONS = new Set(["Q/W/R/T", "SUPERFLEX", "SUPER_FLEX", "OP"]);

function parseRosterSlots(settings: Plain): RosterSlot[] {
  return collection(settings.roster_positions, "roster_position").flatMap(
    (raw) => {
      const parsed = RosterPositionSchema.safeParse(raw);
      if (!parsed.success) return [];

      return [
        {
          position: parsed.data.position,
          positionType: parsed.data.position_type ?? null,
          count: parsed.data.count,
          isStarting:
            parsed.data.is_starting_position === undefined
              ? parsed.data.position !== "BN" && parsed.data.position !== "IR"
              : parsed.data.is_starting_position === 1,
        },
      ];
    },
  );
}

function parsePpr(settings: Plain): number {
  const modifiers = isPlainObject(settings.stat_modifiers)
    ? settings.stat_modifiers
    : {};

  for (const entry of collection(modifiers.stats, "stat")) {
    if (Number(entry.stat_id) === RECEPTIONS_STAT_ID) {
      const value = Number(entry.value);
      return Number.isFinite(value) ? value : 0;
    }
  }

  return 0;
}

/** FantasyCalc's `numQbs`: 1 for a standard league, 2 for superflex. */
function parseNumQbs(slots: RosterSlot[]): number {
  const starting = slots.filter((slot) => slot.isStarting);
  const qbs = starting
    .filter((slot) => slot.position === "QB")
    .reduce((total, slot) => total + slot.count, 0);
  const superflex = starting.some((slot) =>
    SUPERFLEX_POSITIONS.has(slot.position),
  );

  return Math.min(2, Math.max(1, qbs + (superflex ? 1 : 0)));
}

/**
 * Redraft is the design target (§1.1). We still read the keeper flags so the
 * app can warn instead of silently mis-valuing a keeper league. Yahoo has
 * spelled this several ways, so check all of them.
 */
function parseIsDynasty(settings: Plain): boolean {
  for (const key of ["is_keeper", "is_keeper_league", "uses_keepers"]) {
    if (yahooBool(settings[key])) return true;
  }

  const deadline = settings.keeper_deadline;
  return typeof deadline === "string" && deadline !== "" && deadline !== "0";
}

function parseManagerName(team: Plain): {
  managerName: string | null;
  isCurrentLogin: boolean;
} {
  const managers = collection(team.managers, "manager");

  const names = managers
    .map((manager) => manager.nickname)
    .filter((name): name is string => typeof name === "string" && name !== "")
    .filter((name) => name !== "--hidden--");

  return {
    managerName: names.length > 0 ? names.join(" & ") : null,
    isCurrentLogin: managers.some((manager) =>
      yahooBool(manager.is_current_login),
    ),
  };
}

function parseTeam(team: Plain): TeamImport | null {
  const teamKey = typeof team.team_key === "string" ? team.team_key : null;
  const name = typeof team.name === "string" ? team.name : null;
  if (!teamKey || !name) return null;

  const standings = isPlainObject(team.team_standings) ? team.team_standings : {};
  const outcomes = isPlainObject(standings.outcome_totals)
    ? standings.outcome_totals
    : {};

  const logo = collection(team.team_logos, "team_logo").find(
    (entry) => typeof entry.url === "string" && entry.url !== "",
  );

  const { managerName, isCurrentLogin } = parseManagerName(team);

  const number = (value: unknown) => {
    const parsed = optionalNumber.safeParse(value);
    return parsed.success && parsed.data !== undefined ? parsed.data : null;
  };

  return {
    teamKey,
    teamId: number(team.team_id),
    name,
    managerName,
    logoUrl: logo ? String(logo.url) : null,
    isUsersTeam: yahooBool(team.is_owned_by_current_login) || isCurrentLogin,
    wins: number(outcomes.wins),
    losses: number(outcomes.losses),
    ties: number(outcomes.ties),
    pointsFor: number(standings.points_for),
    pointsAgainst: number(standings.points_against),
    rank: number(standings.rank),
    playoffSeed: number(standings.playoff_seed),
    waiverPriority: number(team.waiver_priority),
    faabBalance: number(team.faab_balance),
    numberOfMoves: number(team.number_of_moves),
    numberOfTrades: number(team.number_of_trades),
  };
}

/** Shapes a `league;out=settings,standings,teams` payload into our domain types. */
export function parseLeague(content: Plain): {
  league: LeagueImport;
  teams: TeamImport[];
} {
  const node = leagueNode(content);
  const meta = LeagueMetaSchema.parse(node);
  const settings = toArray(node.settings).filter(isPlainObject)[0] ?? {};
  const rosterSlots = parseRosterSlots(settings);

  // `teams` carries the roster metadata, `standings` carries the records. The
  // same team appears in both; standings wins on overlap.
  const standingsNode = isPlainObject(node.standings)
    ? node.standings.teams
    : node.standings;

  const byKey = new Map<string, Plain>();
  for (const team of [
    ...collection(node.teams, "team"),
    ...collection(standingsNode, "team"),
  ]) {
    const key = typeof team.team_key === "string" ? team.team_key : null;
    if (!key) continue;
    byKey.set(key, { ...byKey.get(key), ...team });
  }

  const teams = [...byKey.values()]
    .map(parseTeam)
    .filter((team): team is TeamImport => team !== null)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  return {
    league: {
      leagueKey: meta.league_key,
      gameKey: meta.league_key.split(".")[0],
      name: meta.name,
      season: meta.season,
      numTeams: meta.num_teams ?? teams.length ?? null,
      scoringType: meta.scoring_type ?? null,
      ppr: parsePpr(settings),
      numQbs: parseNumQbs(rosterSlots),
      rosterSlots,
      isDynasty: parseIsDynasty(settings),
      currentWeek: meta.current_week ?? null,
      startWeek: meta.start_week ?? null,
      endWeek: meta.end_week ?? null,
      logoUrl: meta.logo_url ?? null,
      url: meta.url ?? null,
      isFinished: meta.is_finished === 1,
    },
    teams,
  };
}

// ---------------------------------------------------------------------------
// players (rosters + free agents)
// ---------------------------------------------------------------------------

const YahooPlayerSchema = z.object({
  player_key: z.string(),
  player_id: z.coerce.string(),
  name: z.object({ full: z.string() }),
  editorial_team_abbr: optionalString,
  display_position: optionalString,
  position_type: optionalString,
  status: optionalString,
  injury_note: optionalString,
  image_url: optionalString,
  bye_weeks: z.object({ week: optionalNumber }).optional(),
});

export type YahooPlayer = {
  playerId: string;
  playerKey: string;
  name: string;
  /** Yahoo's `display_position`: "WR", "RB,WR" for multi-eligible, "DEF". */
  position: string | null;
  positionType: string | null;
  nflTeam: string | null;
  /** Yahoo models a defense as a team entity — resolved by team abbr (§4). */
  isDefense: boolean;
  status: string | null;
  injuryNote: string | null;
  byeWeek: number | null;
  imageUrl: string | null;
  /** The slot the manager has this player in; null for a free agent. */
  selectedPosition: string | null;
  isStarter: boolean;
};

/** Slots that hold a player without starting them. */
const BENCH_SLOTS = new Set(["BN", "IR", "IR+", "IR-R", "NA"]);

function parsePlayer(raw: Plain): YahooPlayer | null {
  const parsed = YahooPlayerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;

  const selected = isPlainObject(raw.selected_position)
    ? raw.selected_position
    : {};
  const selectedPosition =
    typeof selected.position === "string" && selected.position !== ""
      ? selected.position
      : null;

  return {
    playerId: p.player_id,
    playerKey: p.player_key,
    name: p.name.full,
    position: p.display_position ?? null,
    positionType: p.position_type ?? null,
    nflTeam: p.editorial_team_abbr ?? null,
    isDefense: p.position_type === "DT" || p.display_position === "DEF",
    status: p.status ?? null,
    injuryNote: p.injury_note ?? null,
    byeWeek: p.bye_weeks?.week ?? null,
    imageUrl: p.image_url ?? null,
    selectedPosition,
    isStarter: selectedPosition !== null && !BENCH_SLOTS.has(selectedPosition),
  };
}

export type TeamRoster = {
  teamKey: string;
  players: YahooPlayer[];
};

function leagueNode(content: Plain): Plain {
  const node = isPlainObject(content.league) ? content.league : null;
  if (!node) throw new YahooParseError("No league in the Yahoo response");
  return node;
}

/** Shapes a `league/{key}/teams;out=roster` payload. */
export function parseRosters(content: Plain): TeamRoster[] {
  const rosters: TeamRoster[] = [];

  for (const team of collection(leagueNode(content).teams, "team")) {
    const teamKey = typeof team.team_key === "string" ? team.team_key : null;
    if (!teamKey) continue;

    // `roster` arrives as a counted collection wrapping one entry, which
    // normalizes to a single-element array rather than a bare object.
    const players = toArray(team.roster)
      .filter(isPlainObject)
      .flatMap((node) => collection(node.players, "player"))
      .map(parsePlayer)
      .filter((player): player is YahooPlayer => player !== null);

    rosters.push({ teamKey, players });
  }

  return rosters;
}

/** Shapes a `league/{key}/players;status=A;start=n;count=25` page. */
export function parsePlayerList(content: Plain): YahooPlayer[] {
  return collection(leagueNode(content).players, "player")
    .map(parsePlayer)
    .filter((player): player is YahooPlayer => player !== null);
}

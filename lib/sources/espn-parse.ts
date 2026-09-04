/**
 * Pure parsers for ESPN Fantasy payloads. No transport, no `server-only`, no
 * path aliases — same rules as the Yahoo parsers next door, and for the same
 * reason: this is the only way to exercise the shaping code without a live
 * league in front of it.
 *
 * The output types are Yahoo's. That is deliberate and it is the whole point
 * of the ESPN path: `LeagueImport`, `TeamImport`, `TeamRoster` and
 * `MatchupImport` are not descriptions of Yahoo, they are the contract every
 * import writes against, and everything downstream of `leagues`/`teams`/
 * `rosters` reads Postgres rather than either API. Restating them under new
 * names would only give the two halves something to drift apart on.
 */
import { z } from "zod";

import type {
  LeagueImport,
  MatchupImport,
  RosterSlot,
  TeamImport,
  TeamRoster,
  YahooPlayer,
} from "./yahoo-parse";

export type { LeagueImport, MatchupImport, TeamImport, TeamRoster };
/** ESPN's players wear the same shape Yahoo's do; the ids inside differ. */
export type EspnPlayer = YahooPlayer;

export class EspnParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EspnParseError";
  }
}

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

/** Which ESPN league a row came from. Season is part of it: ESPN reuses a
 *  league id across years, and each year is a different board. */
export type EspnLeagueRef = { leagueId: string; season: number };

const ESPN_PREFIX = "espn:";

/**
 * The synthetic `yahoo_league_key` an ESPN league carries.
 *
 * Derived rather than random, unlike a manual league's: reconnecting the same
 * ESPN league has to land on the row it made last time — that is what makes a
 * re-import a refresh instead of a duplicate board.
 */
export function espnLeagueKey(ref: EspnLeagueRef): string {
  return `${ESPN_PREFIX}${ref.season}:${ref.leagueId}`;
}

export function espnTeamKey(ref: EspnLeagueRef, teamId: number): string {
  return `${espnLeagueKey(ref)}:t${teamId}`;
}

export function isEspnLeagueKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.startsWith(ESPN_PREFIX);
}

/** Reads a ref back out of a stored key. Null if it is not one of ours. */
export function parseEspnLeagueKey(key: string): EspnLeagueRef | null {
  const match = /^espn:(\d{4}):([^:]+)$/.exec(key);
  if (!match) return null;
  return { season: Number(match[1]), leagueId: match[2] };
}

/**
 * ESPN puts the account id in braces in the SWID cookie and — usually, but
 * not always — in a team's `owners` array too. Compared case- and
 * brace-insensitively so "which team is mine" does not hinge on punctuation.
 */
export function normalizeSwid(swid: string | null | undefined): string | null {
  if (!swid) return null;
  const bare = swid.trim().replace(/^\{|\}$/g, "").toUpperCase();
  return bare === "" ? null : bare;
}

// ---------------------------------------------------------------------------
// ESPN's integer vocabularies
// ---------------------------------------------------------------------------

/**
 * Lineup slots. ESPN numbers them and never sends the names, so the map is
 * the names. The IDP and coach slots are here because a league that uses them
 * would otherwise report a starting slot called "23" on the settings panel.
 */
const LINEUP_SLOTS: Record<number, string> = {
  0: "QB",
  1: "TQB",
  2: "RB",
  3: "RB/WR",
  4: "WR",
  5: "WR/TE",
  6: "TE",
  7: "OP",
  8: "DT",
  9: "DE",
  10: "LB",
  11: "DL",
  12: "CB",
  13: "S",
  14: "DB",
  15: "DP",
  16: "D/ST",
  17: "K",
  18: "P",
  19: "HC",
  20: "BN",
  21: "IR",
  23: "FLEX",
  24: "EDR",
};

/** Slots that hold a player without starting them. */
const BENCH_SLOTS = new Set(["BN", "IR"]);

/** `defaultPositionId`. Only the offensive ones and D/ST matter for values. */
const POSITIONS: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  7: "P",
  9: "DT",
  10: "DE",
  11: "LB",
  12: "CB",
  13: "S",
  14: "DB",
  16: "D/ST",
};

const DEFENSE_POSITION_ID = 16;

/**
 * `proTeamId` to the abbreviation the rest of the app speaks. ESPN's own
 * spellings are kept where they differ from Sleeper's (WSH, not WAS) because
 * `normalizeTeam` in the crosswalk already aliases them — one place for that
 * knowledge is better than two that can disagree.
 */
const PRO_TEAMS: Record<number, string> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WSH",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

/**
 * ESPN's injury words, in the short codes the player pages already render for
 * Yahoo. `ACTIVE` and `NORMAL` are not a status, they are the absence of one.
 */
const INJURY_STATUS: Record<string, string | null> = {
  ACTIVE: null,
  NORMAL: null,
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  INJURY_RESERVE: "IR",
  SUSPENSION: "SUSP",
  PROBABLE: "P",
  DAY_TO_DAY: "DTD",
  FOUR_GAME_SUSPENSION: "SUSP",
  TEN_GAME_SUSPENSION: "SUSP",
};

/** ESPN stat 53 is Receptions — the PPR value in one number, as Yahoo's 11 is. */
const RECEPTIONS_STAT_ID = 53;

/** Slots that let a QB start, which is what makes a league superflex. */
const SUPERFLEX_SLOTS = new Set(["OP", "TQB"]);

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------

/**
 * Everything here is `.passthrough()`-shaped in spirit: ESPN adds fields
 * constantly and none of them are our business, so each schema names only what
 * is read and every optional stays optional. A payload that has moved on is
 * parsed for what it still carries rather than rejected whole.
 */
const num = z.number().nullish();
const str = z.string().nullish();

const RosterSettingsSchema = z.object({
  lineupSlotCounts: z.record(z.string(), z.number()).nullish(),
});

const ScoringItemSchema = z.object({ statId: z.number(), points: num });

const SettingsSchema = z.object({
  name: str,
  size: num,
  rosterSettings: RosterSettingsSchema.nullish(),
  scoringSettings: z
    .object({
      scoringType: str,
      scoringItems: z.array(ScoringItemSchema).nullish(),
    })
    .nullish(),
  scheduleSettings: z
    .object({
      matchupPeriodCount: num,
      playoffMatchupPeriodLength: num,
    })
    .nullish(),
  draftSettings: z.object({ keeperCount: num }).nullish(),
  acquisitionSettings: z.object({ acquisitionBudget: num }).nullish(),
});

const StatusSchema = z.object({
  currentMatchupPeriod: num,
  firstScoringPeriod: num,
  finalScoringPeriod: num,
  latestScoringPeriod: num,
  isActive: z.boolean().nullish(),
});

const MemberSchema = z.object({
  id: z.string(),
  displayName: str,
  firstName: str,
  lastName: str,
});

const TeamSchema = z.object({
  id: z.number(),
  name: str,
  location: str,
  nickname: str,
  abbrev: str,
  logo: str,
  owners: z.array(z.string()).nullish(),
  playoffSeed: num,
  rankCalculatedFinal: num,
  waiverRank: num,
  record: z
    .object({
      overall: z
        .object({
          wins: num,
          losses: num,
          ties: num,
          pointsFor: num,
          pointsAgainst: num,
        })
        .nullish(),
    })
    .nullish(),
  transactionCounter: z
    .object({
      acquisitions: num,
      trades: num,
      acquisitionBudgetSpent: num,
    })
    .nullish(),
});

const PlayerSchema = z.object({
  id: z.number(),
  fullName: str,
  firstName: str,
  lastName: str,
  defaultPositionId: num,
  proTeamId: num,
  injuryStatus: str,
});

const RosterEntrySchema = z.object({
  playerId: z.number(),
  lineupSlotId: num,
  playerPoolEntry: z.object({ player: PlayerSchema }).nullish(),
  // Older seasons hang the player straight off the entry.
  player: PlayerSchema.nullish(),
});

const LeaguePayloadSchema = z.object({
  id: z.union([z.number(), z.string()]).nullish(),
  seasonId: num,
  scoringPeriodId: num,
  settings: SettingsSchema.nullish(),
  status: StatusSchema.nullish(),
  members: z.array(MemberSchema).nullish(),
  teams: z
    .array(TeamSchema.extend({ roster: z.object({ entries: z.array(RosterEntrySchema).nullish() }).nullish() }))
    .nullish(),
  schedule: z
    .array(
      z.object({
        matchupPeriodId: num,
        winner: str,
        playoffTierType: str,
        home: z.object({ teamId: num, totalPoints: num }).nullish(),
        away: z.object({ teamId: num, totalPoints: num }).nullish(),
      }),
    )
    .nullish(),
});

const FreeAgentPayloadSchema = z.object({
  players: z
    .array(
      z.object({
        id: z.number().nullish(),
        onTeamId: num,
        player: PlayerSchema,
      }),
    )
    .nullish(),
});

/**
 * ESPN answers a `leagueHistory` request with a one-element array rather than
 * an object. Unwrapped here so every caller downstream sees one league.
 */
export function unwrapLeaguePayload(raw: unknown): unknown {
  return Array.isArray(raw) ? raw[0] : raw;
}

function parseLeaguePayload(raw: unknown) {
  const parsed = LeaguePayloadSchema.safeParse(unwrapLeaguePayload(raw));
  if (!parsed.success) {
    throw new EspnParseError(
      `Unexpected ESPN league payload: ${parsed.error.issues[0]?.message ?? "unreadable"}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

function parseRosterSlots(
  counts: Record<string, number> | null | undefined,
): RosterSlot[] {
  return Object.entries(counts ?? {})
    .map(([id, count]) => ({ id: Number(id), count }))
    .filter((slot) => Number.isFinite(slot.id) && slot.count > 0)
    .sort((a, b) => a.id - b.id)
    .map((slot) => {
      const position = LINEUP_SLOTS[slot.id] ?? `SLOT_${slot.id}`;
      return {
        position,
        positionType: position === "D/ST" ? "DT" : position === "K" ? "K" : "O",
        count: slot.count,
        isStarting: !BENCH_SLOTS.has(position),
      };
    });
}

/** FantasyCalc's `numQbs`: 1 for a standard league, 2 for superflex. */
function parseNumQbs(slots: RosterSlot[]): number {
  const starting = slots.filter((slot) => slot.isStarting);
  const qbs = starting
    .filter((slot) => slot.position === "QB")
    .reduce((total, slot) => total + slot.count, 0);
  const superflex = starting.some((slot) => SUPERFLEX_SLOTS.has(slot.position));

  return Math.min(2, Math.max(1, qbs + (superflex ? 1 : 0)));
}

function parsePpr(items: { statId: number; points?: number | null }[]): number {
  for (const item of items) {
    if (item.statId === RECEPTIONS_STAT_ID) {
      return Number.isFinite(item.points) ? Number(item.points) : 0;
    }
  }
  return 0;
}

/** ESPN's `H2H_POINTS` in the vocabulary the league badge already renders. */
function parseScoringType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("H2H")) return "head";
  if (raw.startsWith("TOTAL") || raw.includes("POINTS")) return "points";
  return raw.toLowerCase();
}

export function espnLeagueUrl(ref: EspnLeagueRef): string {
  return `https://fantasy.espn.com/football/league?leagueId=${encodeURIComponent(
    ref.leagueId,
  )}&seasonId=${ref.season}`;
}

// ---------------------------------------------------------------------------
// league + teams
// ---------------------------------------------------------------------------

function memberNames(
  members: { id: string; displayName?: string | null; firstName?: string | null; lastName?: string | null }[],
): Map<string, string> {
  const names = new Map<string, string>();

  for (const member of members) {
    const name =
      member.displayName?.trim() ||
      [member.firstName, member.lastName].filter(Boolean).join(" ").trim();

    const key = normalizeSwid(member.id);
    if (key && name) names.set(key, name);
  }

  return names;
}

function teamName(team: z.infer<typeof TeamSchema>): string {
  const named = team.name?.trim();
  if (named) return named;

  const composed = [team.location, team.nickname]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();

  return composed || team.abbrev?.trim() || `Team ${team.id}`;
}

export type EspnLeagueImport = {
  league: LeagueImport;
  teams: TeamImport[];
  /**
   * Whether the payload could say which team belongs to the signed-in user.
   *
   * False for a public league read without cookies — ESPN will happily hand
   * over twelve rosters without ever being told who is asking. The import
   * treats that as "do not touch the flag" rather than "no team is theirs",
   * so the choice the user makes on the board survives every later sync.
   */
  knowsUsersTeam: boolean;
};

/**
 * Shapes one `?view=mSettings&view=mTeam` payload into the league and its
 * teams. `swid` is the signed-in account, when there is one.
 */
export function parseEspnLeague(
  raw: unknown,
  ref: EspnLeagueRef,
  swid?: string | null,
): EspnLeagueImport {
  const payload = parseLeaguePayload(raw);
  const settings = payload.settings ?? {};
  const status = payload.status ?? {};

  const rosterSlots = parseRosterSlots(settings.rosterSettings?.lineupSlotCounts);
  const teamsRaw = payload.teams ?? [];
  const names = memberNames(payload.members ?? []);
  const mine = normalizeSwid(swid);
  const budget = settings.acquisitionSettings?.acquisitionBudget ?? null;

  const teams: TeamImport[] = teamsRaw.map((team) => {
    const overall = team.record?.overall ?? {};
    const owners = (team.owners ?? []).map(normalizeSwid).filter(Boolean);
    const spent = team.transactionCounter?.acquisitionBudgetSpent ?? null;

    return {
      teamKey: espnTeamKey(ref, team.id),
      teamId: team.id,
      name: teamName(team),
      managerName:
        owners.map((owner) => names.get(owner!)).filter(Boolean).join(" & ") ||
        null,
      logoUrl: team.logo?.trim() || null,
      isUsersTeam: mine !== null && owners.includes(mine),
      wins: overall.wins ?? null,
      losses: overall.losses ?? null,
      ties: overall.ties ?? null,
      pointsFor: overall.pointsFor ?? null,
      pointsAgainst: overall.pointsAgainst ?? null,
      // ESPN's "rank" during the season is the seed it would give you today;
      // `rankCalculatedFinal` is only filled in once the season is over.
      rank: team.rankCalculatedFinal || team.playoffSeed || null,
      playoffSeed: team.playoffSeed ?? null,
      waiverPriority: team.waiverRank ?? null,
      // ESPN reports the budget and what has been spent from it. What every
      // waiver screen in this app wants is what is left.
      faabBalance:
        budget !== null && spent !== null ? Math.max(0, budget - spent) : null,
      numberOfMoves: team.transactionCounter?.acquisitions ?? null,
      numberOfTrades: team.transactionCounter?.trades ?? null,
    };
  });

  const currentWeek =
    status.currentMatchupPeriod ?? payload.scoringPeriodId ?? null;
  // `finalScoringPeriod` first, and the order matters. `matchupPeriodCount` is
  // how many matchup periods the *regular season* has — 14 in a default ESPN
  // league — so reading it first ended the season three weeks early: the
  // projection grid stopped at week 14, and every rest-of-season value was
  // prorated over 14 weeks of a 17-week season. Playoff weeks are weeks a
  // player still scores in, and a value that ignores them is wrong for exactly
  // the matches the manager cares most about.
  const endWeek =
    status.finalScoringPeriod ??
    settings.scheduleSettings?.matchupPeriodCount ??
    null;

  const league: LeagueImport = {
    leagueKey: espnLeagueKey(ref),
    // Yahoo's game key names the sport and season ("nfl.l.123" comes from game
    // 449). ESPN's equivalent is the sport path segment, which is fixed.
    gameKey: "ffl",
    name: settings.name?.trim() || `ESPN league ${ref.leagueId}`,
    season: payload.seasonId ?? ref.season,
    numTeams: settings.size ?? (teams.length || null),
    scoringType: parseScoringType(settings.scoringSettings?.scoringType),
    ppr: parsePpr(settings.scoringSettings?.scoringItems ?? []),
    numQbs: parseNumQbs(rosterSlots),
    rosterSlots,
    // Redraft is the design target (§1.1); the keeper count is read so the
    // board can warn rather than silently mis-price a keeper league.
    isDynasty: (settings.draftSettings?.keeperCount ?? 0) > 0,
    currentWeek,
    startWeek: status.firstScoringPeriod ?? null,
    endWeek,
    logoUrl: null,
    url: espnLeagueUrl(ref),
    isFinished: status.isActive === false,
  };

  return { league, teams, knowsUsersTeam: mine !== null };
}

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------

function playerName(player: z.infer<typeof PlayerSchema>): string {
  const full = player.fullName?.trim();
  if (full) return full;
  return [player.firstName, player.lastName].filter(Boolean).join(" ").trim();
}

function toPlayer(
  player: z.infer<typeof PlayerSchema>,
  slotId: number | null,
): EspnPlayer | null {
  const name = playerName(player);
  if (!name) return null;

  const positionId = player.defaultPositionId ?? null;
  const position = positionId === null ? null : (POSITIONS[positionId] ?? null);
  const isDefense = positionId === DEFENSE_POSITION_ID;
  const slot = slotId === null ? null : (LINEUP_SLOTS[slotId] ?? null);
  const status = player.injuryStatus?.toUpperCase() ?? null;

  return {
    playerId: String(player.id),
    playerKey: `espn:${player.id}`,
    name,
    position,
    positionType: isDefense ? "DT" : position === "K" ? "K" : "O",
    nflTeam:
      player.proTeamId != null ? (PRO_TEAMS[player.proTeamId] ?? null) : null,
    isDefense,
    // `?? status` would be wrong here: the map's whole point is that some
    // words mean "no status", and those map to null deliberately. A word the
    // map has never heard of is passed through instead of dropped — an unknown
    // badge is more honest than a missing one.
    status:
      status === null
        ? null
        : status in INJURY_STATUS
          ? INJURY_STATUS[status]
          : status,
    // ESPN's roster and player-info views carry the status but never a note
    // about it. The badge still lands; only the body part is missing.
    injuryNote: null,
    byeWeek: null,
    imageUrl: null,
    selectedPosition: slot,
    isStarter: slot !== null && !BENCH_SLOTS.has(slot),
  };
}

function entryPlayer(entry: z.infer<typeof RosterEntrySchema>) {
  return entry.playerPoolEntry?.player ?? entry.player ?? null;
}

/** Shapes a `?view=mRoster&view=mTeam` payload into one roster per team. */
export function parseEspnRosters(raw: unknown, ref: EspnLeagueRef): TeamRoster[] {
  const payload = parseLeaguePayload(raw);

  return (payload.teams ?? []).map((team) => ({
    teamKey: espnTeamKey(ref, team.id),
    players: (team.roster?.entries ?? [])
      .map((entry) => {
        const player = entryPlayer(entry);
        return player ? toPlayer(player, entry.lineupSlotId ?? null) : null;
      })
      .filter((player): player is EspnPlayer => player !== null),
  }));
}

/**
 * Shapes a `?view=kona_player_info` page. ESPN answers the availability filter
 * with everyone it was asked for, so `onTeamId` is checked rather than trusted
 * — a rostered player who slipped through is not a free agent.
 */
export function parseEspnFreeAgents(raw: unknown): EspnPlayer[] {
  const parsed = FreeAgentPayloadSchema.safeParse(unwrapLeaguePayload(raw));
  if (!parsed.success) {
    throw new EspnParseError("Unexpected ESPN player payload");
  }

  return (parsed.data.players ?? [])
    .filter((entry) => !entry.onTeamId)
    .map((entry) => toPlayer(entry.player, null))
    .filter((player): player is EspnPlayer => player !== null);
}

// ---------------------------------------------------------------------------
// matchups
// ---------------------------------------------------------------------------

/**
 * Shapes a `?view=mMatchup` schedule, keeping only the weeks asked for.
 *
 * ESPN returns the whole season's schedule in one payload regardless, so the
 * week list is a filter rather than a request — which is why the transport
 * side asks for matchups once and not once per chunk of weeks.
 */
export function parseEspnMatchups(
  raw: unknown,
  ref: EspnLeagueRef,
  weeks?: number[],
): MatchupImport[] {
  const payload = parseLeaguePayload(raw);
  const wanted = weeks && weeks.length > 0 ? new Set(weeks) : null;
  const matchups: MatchupImport[] = [];

  for (const entry of payload.schedule ?? []) {
    const week = entry.matchupPeriodId ?? null;
    if (week === null || (wanted && !wanted.has(week))) continue;

    const homeId = entry.home?.teamId ?? null;
    if (homeId === null) continue;

    const awayId = entry.away?.teamId ?? null;
    const decided = Boolean(entry.winner && entry.winner !== "UNDECIDED");

    matchups.push({
      week,
      teamKeyA: espnTeamKey(ref, homeId),
      // A bye leaves one side of the pairing empty, exactly as Yahoo does.
      teamKeyB: awayId === null ? null : espnTeamKey(ref, awayId),
      pointsA: entry.home?.totalPoints ?? null,
      pointsB: entry.away?.totalPoints ?? null,
      // ESPN publishes no projected total on this view.
      projectedA: null,
      projectedB: null,
      status: decided ? "postevent" : "preevent",
      isPlayoffs: Boolean(
        entry.playoffTierType && entry.playoffTierType !== "NONE",
      ),
    });
  }

  return matchups;
}

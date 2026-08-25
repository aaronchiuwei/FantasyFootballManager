import "server-only";

import type { Db } from "@/lib/supabase/db";
import type { Database } from "@/lib/supabase/database.types";
import { loadTradeBoard, type TradeBoard, type TradeBoardAsset } from "@/lib/trades/store";

import {
  CYCLE_LIMITS,
  searchCycles,
  type CycleStats,
  type CycleSuggestion,
} from "./cycles";
import {
  buildCyclePayload,
  buildSuggestionPayload,
  parseCyclePayload,
  parseSuggestionPayload,
  type CyclePayload,
  type NamedSuggestionAsset,
  type SuggestionPayload,
} from "./payload";
import {
  buildPackages,
  searchWinWin,
  WIN_WIN_LIMITS,
  type BuilderStats,
  type SearchStats,
  type Suggestion,
  type SuggestionTeam,
} from "./search";

/**
 * The suggestion engines' persistence and their one read (§7, §8, §9 stage 8).
 *
 * The search lives next door in `./search` and never touches this file, the way
 * `analyze.ts` never touches `lib/trades/store.ts`. What happens here is the
 * part §9 gives to a sync stage — fold every pair of rosters in the league into
 * a ranked list, write it down — plus the two reads the screens make.
 *
 * Takes a `Db` rather than making one, like every other data-access module: the
 * sync pipeline calls it with the service role, and the pages with the user's
 * RLS-bound client.
 *
 * **Both engines run over the trade analyzer's own board.** `loadTradeBoard`
 * already reads every rostered player with their value, provenance and
 * rest-of-season points, and now carries §7's `surplusZ` alongside `need`. A
 * second query shaped for the search would be a second definition of "what is
 * on this league's rosters", and the two would drift.
 */

/** One board asset, in the shape both scorers and the payload need. */
export type SuggestionBoardAsset = TradeBoardAsset & NamedSuggestionAsset;

/**
 * The board's assets, projected into the currency the lineup math is written
 * in. `rosPoints` and `points` are the same number under two names — the board
 * calls it what §5 stored, the lineup calls it what it does with it — and the
 * conversion happens once here rather than tens of thousands of times inside
 * the search.
 */
function asSearchAsset(asset: TradeBoardAsset): SuggestionBoardAsset {
  return { ...asset, points: asset.rosPoints };
}

/** Every team in the league, as `searchWinWin` wants to see them. */
export function toSearchTeams(board: TradeBoard): SuggestionTeam<SuggestionBoardAsset>[] {
  const byTeam = new Map<string, SuggestionBoardAsset[]>(
    board.teams.map((team) => [team.id, []]),
  );

  for (const asset of board.assets) {
    byTeam.get(asset.teamId)?.push(asSearchAsset(asset));
  }

  return board.teams.map((team) => ({
    teamId: team.id,
    // A team whose roster failed to resolve gets an empty one rather than no
    // entry, so the pair count stays the league's own and the absence is
    // visible in the stats instead of quietly shrinking the search.
    roster: byTeam.get(team.id) ?? [],
    surplusZ: team.surplusZ,
    need: team.needs,
  }));
}

function names(board: TradeBoard) {
  const byId = new Map(board.teams.map((team) => [team.id, team.name]));
  return (teamId: string) => ({ teamId, teamName: byId.get(teamId) ?? null });
}

/** Two decimals is well past what any surface renders, and keeps the row small. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// sync stage 8 — the win-win search, cached
// ---------------------------------------------------------------------------

export type SuggestionRun = {
  suggestions: number;
  pairs: number;
  stats: SearchStats;
  /** Wall clock for the search itself, for §9's ~60s stage budget. */
  elapsedMs: number;
  warnings: string[];
};

type SuggestionInsert = Database["public"]["Tables"]["trade_suggestions"]["Insert"];

/**
 * Sync stage 8's third act: §9's win-win search over the values its first act
 * computed and the needs vector its second act wrote.
 *
 * Reads only, like the two before it — every external pull it depends on was
 * made by an earlier stage and committed, which is what lets stage 8 be retried
 * on its own without touching Yahoo, Sleeper or FantasyCalc.
 *
 * The order inside the stage is not arbitrary. The search reads
 * `player_values.ros_points` for its lineup math and `team_needs.surplus_z` for
 * its candidate list, so it has to run after both are on disk — and running it
 * anywhere but here would mean reading the whole league's rosters a third time
 * in a different request.
 */
export async function computeTradeSuggestions(
  db: Db,
  leagueId: string,
): Promise<SuggestionRun> {
  const warnings: string[] = [];
  const board = await loadTradeBoard(db, leagueId);

  const empty: SearchStats = {
    pairs: 0,
    evaluated: 0,
    pruned: 0,
    fair: 0,
    winWin: 0,
    unvalued: 0,
  };

  if (board.teams.length < 2) {
    return {
      suggestions: 0,
      pairs: 0,
      stats: empty,
      elapsedMs: 0,
      warnings: ["Fewer than two teams to trade between — run a sync that reaches Yahoo first."],
    };
  }

  const teams = toSearchTeams(board);
  const started = Date.now();
  const { suggestions, stats } = searchWinWin(
    teams,
    board.rosterSlots,
    board.params,
    WIN_WIN_LIMITS,
  );
  const elapsedMs = Date.now() - started;

  const name = names(board);
  const createdAt = new Date().toISOString();
  const rows: SuggestionInsert[] = [];

  // Ranked within a pair, because that is what the `rank` column means and
  // what makes the upsert land on the previous run's rows in place.
  const perPair = new Map<string, number>();

  for (const suggestion of suggestions) {
    const payload = buildSuggestionPayload(suggestion, {
      a: name(suggestion.teamA),
      b: name(suggestion.teamB),
    });
    // A suggestion the payload refuses is a suggestion whose verdict the
    // analyzer refused, and it must not be written under an invented band (§4).
    if (!payload) continue;

    const key = `${suggestion.teamA}/${suggestion.teamB}`;
    const rank = (perPair.get(key) ?? 0) + 1;
    perPair.set(key, rank);

    rows.push({
      league_id: leagueId,
      team_a: suggestion.teamA,
      team_b: suggestion.teamB,
      payload: payload as unknown as Database["public"]["Tables"]["trade_suggestions"]["Insert"]["payload"],
      score: round(suggestion.score.minGain),
      band: payload.band,
      rank,
      created_at: createdAt,
    });
  }

  if (rows.length > 0) {
    const { error } = await db
      .from("trade_suggestions")
      .upsert(rows, { onConflict: "league_id,team_a,team_b,rank" });

    if (error) throw new Error(`Failed to save suggestions: ${error.message}`);
  }

  // Same shape as the valuation's prune and the needs vector's: rows are
  // written under one run stamp and only then are the leftovers cleared, so an
  // interrupted stage leaves a stale board rather than an empty one.
  const { error: pruneError } = await db
    .from("trade_suggestions")
    .delete()
    .eq("league_id", leagueId)
    .lt("created_at", createdAt);

  if (pruneError) {
    warnings.push(`Stale suggestions could not be cleared: ${pruneError.message}`);
  }

  if (stats.unvalued > 0) {
    warnings.push(
      `${stats.unvalued} rostered player${stats.unvalued === 1 ? "" : "s"} carry no resolved value, so no suggestion can contain ${stats.unvalued === 1 ? "them" : "any of them"}.`,
    );
  }

  if (rows.length === 0 && stats.fair > 0) {
    warnings.push(
      `${stats.fair.toLocaleString()} fair trades exist in this league and none of them improves both starting lineups.`,
    );
  }

  return {
    suggestions: rows.length,
    pairs: stats.pairs,
    stats,
    elapsedMs,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// sync stage 8 — the three-team cycle search, cached (Requirement 11)
// ---------------------------------------------------------------------------

export type CycleRun = {
  cycles: number;
  /** Teams the search ran for — one anchored search each. */
  anchors: number;
  /** Anchors that came back with at least one cycle. */
  anchorsWithCycles: number;
  /** Summed over every anchor, so the stage's detail line can quote the real cost. */
  stats: CycleStats;
  elapsedMs: number;
  warnings: string[];
};

type CycleInsert = Database["public"]["Tables"]["cycle_suggestions"]["Insert"];

/**
 * Sync stage 8's fourth act: Phase 9's cycle search, once per team.
 *
 * **This is cached, and that decision was measured rather than assumed.** The
 * exhaustive three-team space inside §7's own bounds is ~4.07M candidates for a
 * twelve-team league — 48× Phase 8's 85,536, at three analyzer runs a candidate
 * instead of two — which is emphatically not something to put in a stage §9
 * caps at ~60s. What makes it fit is that the search is *anchored* and
 * *bounded*: per anchor it scores at most `11 × 21 × 21` openings and
 * `50 × 10 × 21` closings, so the work is a function of the bounds and not of
 * the league's data. Measured on a synthetic twelve-team league that is ~8 ms
 * an anchor and ~93 ms for all twelve, against the ~33 ms the two-team search
 * next door already spends. The README carries the full table.
 *
 * Running all twelve rather than only the user's own team costs 85 ms more and
 * buys the same thing §9's win-win board buys by covering the whole league:
 * knowing that two other managers have an obvious three-way sitting between
 * them is a reason to get there first.
 *
 * Reads only, like the three acts before it, and it runs last because it needs
 * everything they wrote: `player_values.ros_points` for the lineup math and
 * `team_needs.surplus_z` for the candidate lists.
 */
export async function computeCycleSuggestions(
  db: Db,
  leagueId: string,
): Promise<CycleRun> {
  const warnings: string[] = [];
  const board = await loadTradeBoard(db, leagueId);
  const teams = toSearchTeams(board);

  const stats = emptyCycleStats();

  if (teams.length < 3) {
    return {
      cycles: 0,
      anchors: 0,
      anchorsWithCycles: 0,
      stats: { ...stats, blocked: "too-few-teams" },
      elapsedMs: 0,
      warnings: [
        "Fewer than three teams, so there is no cycle to look for — run a sync that reaches Yahoo first.",
      ],
    };
  }

  const name = names(board);
  const teamName = (teamId: string) => name(teamId).teamName;
  const createdAt = new Date().toISOString();
  const rows: CycleInsert[] = [];

  const started = Date.now();
  let anchorsWithCycles = 0;

  for (const anchor of teams) {
    const found = searchCycles(
      { anchorTeamId: anchor.teamId, teams },
      board.rosterSlots,
      board.params,
      CYCLE_LIMITS,
    );

    accumulate(stats, found.stats);
    if (found.cycles.length > 0) anchorsWithCycles += 1;

    let rank = 0;
    for (const cycle of found.cycles) {
      const payload = buildCyclePayload(
        cycle as CycleSuggestion<SuggestionBoardAsset>,
        teamName,
      );
      // A cycle the payload refuses is one whose legs the analyzer refused, and
      // it must not be written under an invented band (§4).
      if (!payload) continue;

      rank += 1;
      rows.push({
        league_id: leagueId,
        anchor_team: anchor.teamId,
        payload: payload as unknown as CycleInsert["payload"],
        score: round(cycle.score.minGain),
        band: payload.band,
        rank,
        created_at: createdAt,
      });
    }
  }

  const elapsedMs = Date.now() - started;

  if (rows.length > 0) {
    const { error } = await db
      .from("cycle_suggestions")
      .upsert(rows, { onConflict: "league_id,anchor_team,rank" });

    if (error) throw new Error(`Failed to save three-team trades: ${error.message}`);
  }

  // Written under one stamp, leftovers cleared after — the same order the
  // valuation, the needs vector and the win-win search use, so an interrupted
  // stage leaves a stale board rather than an empty one.
  const { error: pruneError } = await db
    .from("cycle_suggestions")
    .delete()
    .eq("league_id", leagueId)
    .lt("created_at", createdAt);

  if (pruneError) {
    warnings.push(`Stale three-team trades could not be cleared: ${pruneError.message}`);
  }

  // The beam is a truncation, not a prune, so what it threw away is a claim the
  // user is owed rather than an implementation detail (§5's rule, applied to a
  // search instead of a value).
  if (stats.dropped > 0) {
    warnings.push(
      `The three-team beam looked at ${stats.beam.toLocaleString()} openings and set aside ${stats.dropped.toLocaleString()} — a beam search is not exhaustive and can miss a cycle that exists.`,
    );
  }

  return {
    cycles: rows.length,
    anchors: teams.length,
    anchorsWithCycles,
    stats,
    elapsedMs,
    warnings,
  };
}

function emptyCycleStats(): CycleStats {
  return {
    orientations: 0,
    space: 0,
    openings: 0,
    openingsPruned: 0,
    viable: 0,
    beam: 0,
    dropped: 0,
    closings: 0,
    closingsPruned: 0,
    cycles: 0,
    unvalued: 0,
    blocked: null,
  };
}

/**
 * Twelve anchored searches, summed into one report.
 *
 * `unvalued` is the exception: it is the same set of players seen twelve times
 * over, so summing it would multiply §4's count by the size of the league and
 * put a wrong number in front of a user. It is a maximum instead.
 */
function accumulate(into: CycleStats, from: CycleStats): void {
  into.orientations += from.orientations;
  into.space += from.space;
  into.openings += from.openings;
  into.openingsPruned += from.openingsPruned;
  into.viable += from.viable;
  into.beam += from.beam;
  into.dropped += from.dropped;
  into.closings += from.closings;
  into.closingsPruned += from.closingsPruned;
  into.cycles += from.cycles;
  into.unvalued = Math.max(into.unvalued, from.unvalued);
  into.blocked = into.blocked ?? from.blocked;
}

// ---------------------------------------------------------------------------
// reading it back
// ---------------------------------------------------------------------------

export type CachedSuggestion = {
  id: string;
  teamA: string;
  teamB: string;
  /** §9's `min(Δlineup_A, Δlineup_B)`, in rest-of-season projected points. */
  score: number;
  rank: number;
  createdAt: string;
  payload: SuggestionPayload;
};

export type SuggestionTeamRow = {
  id: string;
  name: string;
  managerName: string | null;
  isUsersTeam: boolean;
};

/** One cached three-team cycle, as a page reads it back. */
export type CachedCycle = {
  id: string;
  anchorTeamId: string;
  /** §9's objective over three participants, in rest-of-season points. */
  score: number;
  rank: number;
  payload: CyclePayload;
};

export type SuggestionsBoard = {
  teams: SuggestionTeamRow[];
  suggestions: CachedSuggestion[];
  /** Phase 9: the three-team menus, one per team (§7 Req. 11). */
  cycles: CachedCycle[];
  computedAt: string | null;
  /** The analyzer's board, which is also §10's target picker. */
  board: TradeBoard;
};

/** How many cached suggestions a page will ever render at once. */
const BOARD_LIMIT = 200;

/**
 * At most `CYCLE_LIMITS.results` a team, so a twelve-team league tops out at 60
 * rows — small enough to hand the browser whole, which is what lets the anchor
 * filter be a `useMemo` rather than a request, exactly as §9's board is.
 */
const CYCLE_BOARD_LIMIT = 120;

export async function loadSuggestionsBoard(
  db: Db,
  leagueId: string,
): Promise<SuggestionsBoard> {
  const [board, { data, error }, { data: cycleRows, error: cycleError }] =
    await Promise.all([
      loadTradeBoard(db, leagueId),
      db
        .from("trade_suggestions")
        .select("id, team_a, team_b, payload, score, rank, created_at")
        .eq("league_id", leagueId)
        .order("score", { ascending: false })
        .limit(BOARD_LIMIT),
      db
        .from("cycle_suggestions")
        .select("id, anchor_team, payload, score, rank")
        .eq("league_id", leagueId)
        .order("anchor_team")
        .order("rank")
        .limit(CYCLE_BOARD_LIMIT),
    ]);

  if (error) throw new Error(`Failed to read suggestions: ${error.message}`);
  if (cycleError) {
    throw new Error(`Failed to read three-team trades: ${cycleError.message}`);
  }

  const cycles: CachedCycle[] = [];
  for (const row of cycleRows ?? []) {
    const payload = parseCyclePayload(row.payload);
    // Same rule as the pair board: a payload written by a shape this build
    // cannot read is skipped rather than rendered half-way.
    if (!payload) continue;

    cycles.push({
      id: row.id,
      anchorTeamId: row.anchor_team,
      score: Number(row.score),
      rank: row.rank,
      payload,
    });
  }

  let computedAt: string | null = null;
  const suggestions: CachedSuggestion[] = [];

  for (const row of data ?? []) {
    const payload = parseSuggestionPayload(row.payload);
    // A payload written by a shape this build cannot read is skipped rather
    // than rendered half-way. It stays in the table; the next sync overwrites
    // it, which is the difference between a cache and a record.
    if (!payload) continue;

    if (computedAt === null || row.created_at > computedAt) {
      computedAt = row.created_at;
    }

    suggestions.push({
      id: row.id,
      teamA: row.team_a,
      teamB: row.team_b,
      score: Number(row.score),
      rank: row.rank,
      createdAt: row.created_at,
      payload,
    });
  }

  return {
    teams: board.teams.map((team) => ({
      id: team.id,
      name: team.name,
      managerName: team.managerName,
      isUsersTeam: team.isUsersTeam,
    })),
    suggestions,
    cycles,
    computedAt,
    board,
  };
}

// ---------------------------------------------------------------------------
// the player-based builder (Requirement 10)
// ---------------------------------------------------------------------------

export type BuiltPackages = {
  target: { playerId: number; name: string; teamId: string; teamName: string | null };
  packages: SuggestionPayload[];
  stats: BuilderStats;
};

/**
 * §10, server-side: the packages that would buy one named player.
 *
 * Not cached, and that is the difference between the two engines rather than an
 * omission. The win-win search's input is the whole league, which changes once
 * per sync; this one's input is a player the user picked half a second ago, and
 * there are ~180 of them times twelve teams asking. Recomputing over a board
 * that is already in memory costs less than a cache would.
 *
 * The board is re-read on the server rather than trusted from the browser, for
 * the reason `saveTradeAction` re-reads it: the client sends a player id, and
 * the arithmetic that comes back has to be the server's over the server's
 * values.
 */
export async function buildPackagesFor(
  db: Db,
  leagueId: string,
  { targetPlayerId, forTeamId }: { targetPlayerId: number; forTeamId: string },
): Promise<BuiltPackages | null> {
  const board = await loadTradeBoard(db, leagueId);
  const teams = toSearchTeams(board);

  const target = board.assets.find((asset) => asset.playerId === targetPlayerId);
  if (!target) return null;

  const from = teams.find((team) => team.teamId === target.teamId);
  const to = teams.find((team) => team.teamId === forTeamId);
  // Nobody trades with themselves, and a team id the board does not know is
  // not a team.
  if (!from || !to || from.teamId === to.teamId) return null;

  const name = names(board);
  const { suggestions, stats } = buildPackages(
    { target: asSearchAsset(target), from, to },
    board.rosterSlots,
    board.params,
  );

  const packages: SuggestionPayload[] = [];
  for (const suggestion of suggestions) {
    const payload = buildSuggestionPayload(
      suggestion as Suggestion<SuggestionBoardAsset>,
      { a: name(suggestion.teamA), b: name(suggestion.teamB) },
    );
    if (payload) packages.push(payload);
  }

  return {
    target: {
      playerId: target.playerId,
      name: target.name,
      teamId: target.teamId,
      teamName: name(target.teamId).teamName,
    },
    packages,
    stats,
  };
}

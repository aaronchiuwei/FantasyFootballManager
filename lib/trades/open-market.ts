/**
 * The open analyzer's inputs, as pure functions.
 *
 * The league analyzer (§6) prices a trade against a league the user has
 * imported: real rosters, real ownership, a per-league needs vector. This
 * module serves the version of the same question that arrives *before* any of
 * that exists — "is this trade fair" asked by somebody who has not connected
 * Yahoo and may never.
 *
 * Two things have to be decided without a league to read them off, and both
 * are decided here rather than in a page:
 *
 * - **Which market board.** FantasyCalc prices a scoring configuration, not a
 *   league, so with no league to supply one it has to come from the URL — and
 *   an anonymous visitor's query string must not be able to name an arbitrary
 *   board. It is snapped onto an allowlist instead.
 * - **Which player.** With no roster to pick from, the whole board is the
 *   pool, and the only way in is by name.
 *
 * No transport, no `server-only`: the search runs in the browser on every
 * keystroke over a board that is already in memory, for exactly the reason
 * `analyze.ts` does (§2).
 */
const SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b\.?/g;

/**
 * A name reduced to what a person typing it meant.
 *
 * The crosswalk's `normalizeName` (§4) is the same idea one step further — it
 * removes spaces too, because it is deciding whether two *sources* mean one
 * player. A search box is deciding where in a name the user's letters landed,
 * and "start of a word" is the most useful thing it can know, so the spaces
 * are kept here and collapsed separately below.
 */
function searchKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(SUFFIXES, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A FantasyCalc board's parameters — the whole identity of a market board. */
export type OpenScoring = {
  numQbs: number;
  numTeams: number;
  ppr: number;
};

/**
 * Every board this page will ask FantasyCalc for.
 *
 * The list is short on purpose. Each unseen combination costs a live pull from
 * an undocumented third-party API and ~192 upserted rows, and this route is
 * reachable without an account — so the set of boards an anonymous visitor can
 * cause to exist is bounded to these thirty rather than to whatever their
 * query string says. They also happen to be the configurations real redraft
 * leagues actually use.
 */
export const SCORING_CHOICES = {
  numQbs: [1, 2],
  numTeams: [8, 10, 12, 14, 16],
  ppr: [0, 0.5, 1],
} as const;

/** The most common redraft league in North America, and so the default board. */
export const DEFAULT_OPEN_SCORING: OpenScoring = {
  numQbs: 1,
  numTeams: 12,
  ppr: 1,
};

function snap(value: string | undefined, allowed: readonly number[], fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return allowed.includes(parsed) ? parsed : fallback;
}

/**
 * The scoring config named by a query string, snapped to the allowlist.
 *
 * A value that is not on the list falls back to the default rather than
 * erroring: the URL is a convenience for sharing a trade, and a stale or
 * hand-edited one should open the analyzer on the standard board, not a 400.
 */
export function parseScoring(
  query: Record<string, string | string[] | undefined>,
): OpenScoring {
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  return {
    numQbs: snap(one(query.qb), SCORING_CHOICES.numQbs, DEFAULT_OPEN_SCORING.numQbs),
    numTeams: snap(one(query.teams), SCORING_CHOICES.numTeams, DEFAULT_OPEN_SCORING.numTeams),
    ppr: snap(one(query.ppr), SCORING_CHOICES.ppr, DEFAULT_OPEN_SCORING.ppr),
  };
}

export function pprLabel(ppr: number): string {
  if (ppr === 0) return "Standard";
  if (ppr === 0.5) return "Half PPR";
  if (ppr === 1) return "Full PPR";
  return `${ppr} PPR`;
}

/** One line naming the board a verdict was reached on. */
export function scoringLabel(scoring: OpenScoring): string {
  const format = scoring.numQbs >= 2 ? "Superflex" : "1QB";
  return `${scoring.numTeams}-team · ${pprLabel(scoring.ppr)} · ${format}`;
}

/** The query string for a scoring config, as the page's own links write it. */
export function scoringQuery(scoring: OpenScoring): Record<string, string> {
  return {
    teams: String(scoring.numTeams),
    ppr: String(scoring.ppr),
    qb: String(scoring.numQbs),
  };
}

/** Player ids out of a shared link. Bounded, because the link is a stranger's. */
export const MAX_SIDE = 8;

export function parseIds(value: string | string[] | undefined): number[] {
  const raw = Array.isArray(value) ? value[0] : value;

  // Digits only, rather than `parseInt` — which reads "1.5" as 1 and would
  // quietly put a player nobody named into somebody's trade.
  const ids = (raw ?? "")
    .split(",")
    .filter((entry) => /^\d+$/.test(entry.trim()))
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isSafeInteger(entry) && entry > 0);

  return [...new Set(ids)].slice(0, MAX_SIDE);
}

/** Below this a search matches most of the board and is not one. */
export const MIN_SEARCH_LENGTH = 2;

/** How many names the picker will show at once. */
export const SEARCH_LIMIT = 8;

type Searchable = { playerId: number; name: string; position: string | null };

/**
 * The name filter, run in the browser over the whole board.
 *
 * Punctuation, case and suffixes are stripped from both sides, so "aj brown",
 * "A.J. Brown" and "ajbrown" are one search — a picker that cannot find a
 * player because the user did not type his periods is a picker that has sent
 * them back to Yahoo.
 *
 * Ranked by where the match falls, not by value: somebody typing "hill" means
 * Tyreek Hill rather than whoever merely has those letters buried mid-surname,
 * and sorting purely by board order would bury an exact match under whoever
 * happens to be expensive.
 */
export function searchAssets<T extends Searchable>(
  assets: T[],
  query: string,
  { exclude = new Set<number>(), limit = SEARCH_LIMIT }: {
    exclude?: Set<number>;
    limit?: number;
  } = {},
): T[] {
  const term = searchKey(query);
  if (term.length < MIN_SEARCH_LENGTH) return [];

  const tight = term.replace(/ /g, "");
  const hits: { asset: T; rank: number; index: number }[] = [];

  for (const [index, asset] of assets.entries()) {
    if (exclude.has(asset.playerId)) continue;

    const name = searchKey(asset.name);
    const at = name.indexOf(term);

    // Start of the name, then start of any word in it, then anywhere — and
    // last, a match that only appears once the spaces are gone, which is what
    // "ajbrown" and "dkmetcalf" are.
    const rank =
      at === 0 ? 0 : at > 0 && name[at - 1] === " " ? 1 : at > 0 ? 2 : 3;

    if (rank === 3 && !name.replace(/ /g, "").includes(tight)) continue;

    hits.push({ asset, rank, index });
  }

  // `index` is the board's own order, which the query sorts by value — so
  // within a rank the better player comes first, which is the tiebreak a
  // fantasy manager expects.
  hits.sort((a, b) => a.rank - b.rank || a.index - b.index);

  return hits.slice(0, limit).map((hit) => hit.asset);
}

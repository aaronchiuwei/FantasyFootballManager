/**
 * The values board's name filter.
 *
 * The board pages the top 200 of a ~630-player table, which is fine for
 * browsing and useless for the question people actually bring to it — "what is
 * *he* worth". The position and availability filters narrow the board; they do
 * not find a player.
 *
 * Pure, and separate from the page, because the two things worth getting right
 * here are both testable without a database: what counts as a search at all,
 * and what a `%` typed by a user means.
 */

/** Below this a search matches most of the league and is not one. */
export const MIN_QUERY_LENGTH = 2;

/** Long enough for any name; past it someone is pasting, not searching. */
const MAX_QUERY_LENGTH = 60;

/**
 * A user's text as an `ilike` pattern, or `null` if it is not a search yet.
 *
 * Three characters mean something other than themselves on the way to Postgres
 * and a user typing any of them means the character:
 *
 * - `%` and `_` are SQL's own wildcards, escaped with a backslash. `\` is
 *   escaped *first*, or escaping the wildcards afterwards would introduce
 *   pairs that mean something else.
 * - `*` is PostgREST's spelling of `%`, substituted textually before Postgres
 *   ever sees the pattern — so a backslash cannot escape it. It is dropped
 *   instead, which costs nothing: no player's name contains one.
 *
 * Left alone, any of the three turns a search into a match on the whole board,
 * which reads as the filter silently ignoring what was typed.
 */
export function searchPattern(raw: string | undefined): string | null {
  // `*` is dropped before the length gate, not after: a term of nothing but
  // wildcards is not a two-character search, it is `%%` — the whole board,
  // returned as though the user had asked for it.
  const term = (raw ?? "")
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/\*/g, "")
    .trim();

  if (term.length < MIN_QUERY_LENGTH) return null;

  const escaped = term
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");

  return `%${escaped}%`;
}

/**
 * What the page echoes back in its empty state, and what it puts in the input.
 *
 * Trimmed but otherwise untouched: a search that finds nothing has to show the
 * user what it looked for, in the form they typed it, or "no results" is an
 * accusation rather than information.
 */
export function searchLabel(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_QUERY_LENGTH);
}

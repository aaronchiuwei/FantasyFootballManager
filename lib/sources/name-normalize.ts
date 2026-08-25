/**
 * Matches Sleeper's own `search_full_name`: lowercase, strip punctuation and
 * diacritics, drop suffixes, collapse whitespace (§4 step 4). Matching their
 * exact normalization means we can join against `search_full_name` directly
 * instead of maintaining a second normalizer that might drift from theirs.
 */
const SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b\.?/g;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics
    .toLowerCase()
    .replace(SUFFIXES, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

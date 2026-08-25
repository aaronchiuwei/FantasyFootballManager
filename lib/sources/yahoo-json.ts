/**
 * Yahoo's `format=json` is XML with the tags relabelled. Two shapes recur:
 *
 *   1. Counted collections — `{"0": {...}, "1": {...}, "count": 2}`
 *   2. Fragment arrays — one entity split across array members, each a
 *      single-key object: `[[{"team_key": "..."}, {"name": "..."}], {...}]`
 *
 * `normalize()` collapses both into ordinary JS: collections become arrays,
 * fragments merge into one object. Repeated keys inside a fragment array (two
 * co-managers, a list of roster positions) collect into an array rather than
 * overwriting, so nothing is silently dropped.
 *
 * Everything downstream parses the normalized shape with Zod, so a change in
 * Yahoo's payload surfaces as a parse error rather than an undefined field.
 */

export type Plain = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Plain {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericKeys(value: Plain) {
  return Object.keys(value)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b));
}

function mergeFragments(items: unknown[]): Plain {
  const merged: Plain = {};

  for (const item of items) {
    const value = normalize(item);
    if (!isPlainObject(value)) continue;

    for (const [key, entry] of Object.entries(value)) {
      if (!(key in merged)) {
        merged[key] = entry;
        continue;
      }
      const existing = merged[key];
      merged[key] = Array.isArray(existing)
        ? [...existing, entry]
        : [existing, entry];
    }
  }

  return merged;
}

export function normalize(node: unknown): unknown {
  if (Array.isArray(node)) {
    return mergeFragments(node);
  }

  if (!isPlainObject(node)) {
    return node;
  }

  const indices = numericKeys(node);
  if (indices.length > 0) {
    return indices.map((index) => normalize(node[index]));
  }

  const out: Plain = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = normalize(value);
  }
  return out;
}

/** A one-element list and a bare value are the same thing in Yahoo's JSON. */
export function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Pulls `key`-wrapped entities out of a normalized collection, e.g.
 * `collection(league.teams, "team")` for `{"0": {"team": [...]}, "count": 12}`.
 */
export function collection(node: unknown, key: string): Plain[] {
  return toArray(node)
    .filter(isPlainObject)
    .flatMap((item) => toArray(item[key]))
    .filter(isPlainObject);
}

/** Yahoo emits every scalar as a string; `"1"`/`"0"` stand in for booleans. */
export function yahooBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1" || value === "true";
}

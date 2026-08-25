/**
 * Trigram similarity, matching Postgres `pg_trgm`'s definition so the 0.88
 * threshold in §4 step 6 means the same thing here as it would in SQL: pad the
 * string with two leading spaces and one trailing space, cut it into 3-grams,
 * and score |A ∩ B| / |A ∪ B|.
 *
 * Doing it in TypeScript rather than in the database keeps the whole resolution
 * ladder pure and unit-testable, and the candidate set (a few thousand fantasy
 * players) is small enough that the comparison is cheap.
 */
export function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();

  for (let i = 0; i + 3 <= padded.length; i++) {
    out.add(padded.slice(i, i + 3));
  }

  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return a === "" ? 0 : 1;
  if (!a || !b) return 0;

  const left = trigrams(a);
  const right = trigrams(b);

  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) shared++;
  }

  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

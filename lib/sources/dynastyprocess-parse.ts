/** Pure parser for DynastyProcess's `db_playerids.csv`. Fixture-testable. */
import { parseCsv } from "./csv";

export type DynastyProcessRow = {
  sleeperId: string | null;
  yahooId: string | null;
  mergeName: string;
  position: string;
  team: string | null;
};

function orNull(value: string | undefined) {
  return value && value !== "NA" && value !== "" ? value : null;
}

/**
 * Only rows carrying both a `sleeper_id` and a `yahoo_id` are useful here —
 * that's the exact bridge the crosswalk needs (§4 step 2). `merge_name` is
 * DynastyProcess's own normalized name, already lowercase with punctuation
 * stripped, so no re-normalization is needed on this side of the join.
 */
export function parseDynastyProcessIds(csv: string): DynastyProcessRow[] {
  return parseCsv(csv)
    .map((row) => ({
      sleeperId: orNull(row.sleeper_id),
      yahooId: orNull(row.yahoo_id),
      mergeName: row.merge_name ?? "",
      position: row.position ?? "",
      team: orNull(row.team),
    }))
    .filter((row) => row.sleeperId !== null && row.yahooId !== null);
}

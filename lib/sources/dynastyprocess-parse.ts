/** Pure parser for DynastyProcess's `db_playerids.csv`. Fixture-testable. */
import { parseCsv } from "./csv";

export type DynastyProcessRow = {
  sleeperId: string | null;
  yahooId: string | null;
  espnId: string | null;
  mergeName: string;
  position: string;
  team: string | null;
};

function orNull(value: string | undefined) {
  return value && value !== "NA" && value !== "" ? value : null;
}

/**
 * A row is useful when it bridges `sleeper_id` — the id every value source in
 * this app is keyed on — to a provider id the crosswalk has to resolve: Yahoo's
 * or ESPN's (§4 step 2). A row with neither bridges nothing.
 *
 * `merge_name` is DynastyProcess's own normalized name, already lowercase with
 * punctuation stripped, so no re-normalization is needed on this side of the
 * join.
 */
export function parseDynastyProcessIds(csv: string): DynastyProcessRow[] {
  return parseCsv(csv)
    .map((row) => ({
      sleeperId: orNull(row.sleeper_id),
      yahooId: orNull(row.yahoo_id),
      espnId: orNull(row.espn_id),
      mergeName: row.merge_name ?? "",
      position: row.position ?? "",
      team: orNull(row.team),
    }))
    .filter(
      (row) =>
        row.sleeperId !== null &&
        (row.yahooId !== null || row.espnId !== null),
    );
}

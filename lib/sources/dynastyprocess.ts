import "server-only";

import { parseDynastyProcessIds, type DynastyProcessRow } from "./dynastyprocess-parse";

export type { DynastyProcessRow } from "./dynastyprocess-parse";

const CSV_URL =
  "https://github.com/dynastyprocess/data/raw/master/files/db_playerids.csv";

export class DynastyProcessError extends Error {}

/** ~12,480 rows. Fetched once per sync stage; not cached beyond that run. */
export async function fetchDynastyProcessIds(): Promise<DynastyProcessRow[]> {
  const response = await fetch(CSV_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new DynastyProcessError(
      `DynastyProcess crosswalk fetch failed (${response.status})`,
    );
  }

  return parseDynastyProcessIds(await response.text());
}

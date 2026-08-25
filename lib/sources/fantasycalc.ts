import "server-only";

import { parseFantasyCalcValues, type FantasyCalcPlayer } from "./fantasycalc-parse";

export type { FantasyCalcPlayer } from "./fantasycalc-parse";

const API_BASE = "https://api.fantasycalc.com/values/current";

export class FantasyCalcApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FantasyCalcApiError";
  }
}

export type FantasyCalcParams = {
  numQbs: number;
  numTeams: number;
  ppr: number;
};

/**
 * FantasyCalc covers 192 players (QB/RB/WR/TE only, no K/DEF) — the value
 * engine's Tier A (§5). Params come straight from the league's real settings
 * (§1.2), never hardcoded.
 */
export async function fetchFantasyCalcValues(
  params: FantasyCalcParams,
): Promise<FantasyCalcPlayer[]> {
  const url = new URL(API_BASE);
  url.searchParams.set("isDynasty", "false");
  url.searchParams.set("numQbs", String(params.numQbs));
  url.searchParams.set("numTeams", String(params.numTeams));
  url.searchParams.set("ppr", String(params.ppr));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new FantasyCalcApiError(
      `FantasyCalc request failed (${response.status})`,
      response.status,
    );
  }

  const body = await response.json();
  if (!Array.isArray(body)) {
    throw new FantasyCalcApiError("Unexpected FantasyCalc payload shape", 200);
  }

  return parseFantasyCalcValues(body);
}

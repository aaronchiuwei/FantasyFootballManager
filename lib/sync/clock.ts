/**
 * The season clock, as arithmetic. Pure so it can be tested without a live
 * Sleeper state or a database — stage 1 resolves it once per run and every
 * later stage reads the answer off the run's context.
 */
import { SEASON_WEEKS } from "@/lib/values/vor";

import type { SyncContext } from "./plan";

/**
 * How much of the season a redraft asset is still a claim on (§6). Outside the
 * regular season — preseason, or a league whose season is not the live one —
 * the whole slate is ahead, which is also what makes the preseason case fall
 * out of the same arithmetic instead of needing its own branch.
 */
export function weeksRemainingFor({
  isRegularSeason,
  currentWeek,
  startWeek,
  endWeek,
}: {
  isRegularSeason: boolean;
  currentWeek: number | null;
  startWeek: number | null;
  endWeek: number | null;
}): number {
  const end = endWeek ?? SEASON_WEEKS;
  if (!isRegularSeason || currentWeek === null) {
    const start = startWeek ?? 1;
    return Math.min(SEASON_WEEKS, Math.max(1, end - start + 1));
  }

  return Math.min(SEASON_WEEKS, Math.max(1, end - currentWeek + 1));
}

/**
 * The weeks worth asking Yahoo's scoreboard about: those already under way or
 * played. Before kickoff there is no schedule to score, so the answer is none
 * and stage 6 skips the request entirely.
 */
export function playedWeeks(context: SyncContext): number[] {
  if (!context.isRegularSeason || context.currentWeek === null) return [];

  const start = Math.max(1, context.startWeek ?? 1);
  const end = Math.min(context.currentWeek, context.endWeek ?? SEASON_WEEKS);

  const weeks: number[] = [];
  for (let week = start; week <= end; week += 1) weeks.push(week);
  return weeks;
}

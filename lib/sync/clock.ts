/**
 * The season clock, as arithmetic. Pure so it can be tested without a live
 * Sleeper state or a database — stage 1 resolves it once per run and every
 * later stage reads the answer off the run's context.
 */
import { SEASON_WEEKS } from "@/lib/values/vor";

import type { SyncContext } from "./plan";

/**
 * The NFL regular season, which is not the fantasy one. `SEASON_WEEKS` is 17
 * because a fantasy league stops at its championship; Sleeper's game log runs
 * to week 18 regardless, and a prior season pulled for context has to cover all
 * of it or the last week silently disappears.
 */
export const NFL_REGULAR_SEASON_WEEKS = 18;

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

  return weekRange(start, end);
}

/**
 * Every week the league actually plays, whether or not it has happened yet.
 *
 * This is the window the weekly projection grid is pulled over (stage 4). It
 * is the *league's* window rather than the NFL's, for the same reason §1.2
 * reads scoring from Yahoo: a league that ends in week 14 has no use for a
 * projection at week 17, and one that starts late should not show a week 1 it
 * never played.
 */
export function scheduleWeeks(context: SyncContext): number[] {
  const start = Math.max(1, context.startWeek ?? 1);
  const end = Math.min(
    NFL_REGULAR_SEASON_WEEKS,
    Math.max(start, context.endWeek ?? SEASON_WEEKS),
  );

  return weekRange(start, end);
}

/** The whole NFL game log for a finished season, pulled once as context (§12). */
export function priorSeasonWeeks(): number[] {
  return weekRange(1, NFL_REGULAR_SEASON_WEEKS);
}

function weekRange(start: number, end: number): number[] {
  const weeks: number[] = [];
  for (let week = start; week <= end; week += 1) weeks.push(week);
  return weeks;
}

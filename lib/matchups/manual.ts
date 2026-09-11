import "server-only";

import { requireManualLeague } from "@/lib/leagues/manual";
import type { Db } from "@/lib/supabase/db";

import { planSchedule, type SchedulePair } from "./manual-input";

/**
 * Writing a hand-kept league's schedule.
 *
 * Guarded by `requireManualLeague` for the reason every other manual write is:
 * sync stage 7 overwrites `matchups` wholesale for an imported league, so an
 * edit to one is work that disappears at the next sync without saying
 * anything. Refusing is kinder than discarding it later.
 *
 * A week is replaced rather than merged. The editor posts the whole week —
 * every row of it, including the ones left empty — so what it means is "this
 * is the week", and an upsert would leave a pairing the manager had just
 * dissolved sitting in the table with nothing pointing at it.
 */

/** Which teams a league has, in the order the manage screen lists them. */
export async function scheduleTeams(
  db: Db,
  leagueId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from("teams")
    .select("id, name, yahoo_team_id")
    .eq("league_id", leagueId)
    .order("yahoo_team_id", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Could not read the teams: ${error.message}`);
  return (data ?? []).map((team) => ({ id: team.id, name: team.name }));
}

/**
 * Replaces one week of a manual league's schedule. Returns the matchups written.
 *
 * Nothing is written for the scores. A manual league's rosters and the weekly
 * stat grid are already here, and a null `points_a` is what makes `liveSide`
 * add up the stat lines itself — so the schedule is the only thing anybody has
 * to type, and Sunday takes care of the rest. `status` is null for the same
 * reason: there is no provider to have an opinion, and the season clock plus
 * the stat lines settle the phase without one.
 */
export async function saveManualSchedule(
  db: Db,
  leagueId: string,
  week: number,
  pairs: SchedulePair[],
): Promise<number> {
  await requireManualLeague(db, leagueId);

  const teams = await scheduleTeams(db, leagueId);
  const planned = planSchedule(
    teams.map((team) => team.id),
    pairs,
  );

  if (!planned.ok) throw new Error(planned.error);

  await deleteWeek(db, leagueId, week);

  const { error } = await db.from("matchups").insert(
    planned.plan.map((pairing) => ({
      league_id: leagueId,
      week,
      team_a: pairing.teamA,
      team_b: pairing.teamB,
      points_a: null,
      points_b: null,
      projected_a: null,
      projected_b: null,
      status: null,
      is_playoffs: false,
    })),
  );

  if (error) throw new Error(`Could not save the schedule: ${error.message}`);
  return planned.plan.length;
}

/**
 * Empties one week.
 *
 * Its own exported operation as well as the first half of a save, because
 * "this week is not played" is a real thing to want to say — a league that
 * entered week 14 by mistake has no other way to take it back, and a week with
 * one leftover pairing in it reads as a league where ten teams have the week
 * off.
 */
export async function clearManualWeek(
  db: Db,
  leagueId: string,
  week: number,
): Promise<void> {
  await requireManualLeague(db, leagueId);
  await deleteWeek(db, leagueId, week);
}

/** The delete itself, unguarded — both callers above have already checked. */
async function deleteWeek(db: Db, leagueId: string, week: number): Promise<void> {
  const { error } = await db
    .from("matchups")
    .delete()
    .eq("league_id", leagueId)
    .eq("week", week);

  if (error) throw new Error(`Could not clear the week: ${error.message}`);
}

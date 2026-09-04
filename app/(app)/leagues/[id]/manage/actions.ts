"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ManualFormState } from "@/components/leagues/manual-league-form";
import {
  addManualTeam,
  deleteManualTeam,
  removeRosterEntry,
  searchLeaguePlayers,
  setRosterEntry,
  setUsersTeam,
  updateManualLeague,
  updateManualTeam,
  type PlayerHit,
} from "@/lib/leagues/manual";
import { planManualSettings } from "@/lib/leagues/manual-input";
import { createClient } from "@/lib/supabase/server";

/**
 * The manage screen's writes.
 *
 * Every one of them ends in the same two lines — revalidate the league, hand
 * back either nothing or a sentence — so they are written the same way on
 * purpose. The interesting logic is in `lib/leagues/manual.ts`, which is where
 * the invariants live (one owner per player, one team flagged as yours); this
 * file is the round trip and the error message.
 */

export type ActionResult = { error?: string };

async function requireUser(leagueId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/leagues/${leagueId}/manage`)}`);
  }
  return supabase;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/**
 * Everything downstream of the settings is priced off them, and none of it is
 * recomputed here — changing PPR or the lineup changes which FantasyCalc board
 * the league is on and where every replacement rank falls, and both are stage
 * 3 and stage 8's work. The screen says so; this action only records the
 * change.
 */
function refresh(leagueId: string) {
  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath(`/leagues/${leagueId}/manage`);
  revalidatePath(`/leagues/${leagueId}/moves`);
}

export async function updateSettingsAction(
  leagueId: string,
  _state: ManualFormState,
  formData: FormData,
): Promise<ManualFormState> {
  const supabase = await requireUser(leagueId);

  const planned = planManualSettings(Object.fromEntries(formData));
  if (!planned.ok) return { error: planned.error };

  try {
    await updateManualLeague(supabase, leagueId, planned.plan);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  revalidatePath("/leagues");
  return {};
}

// ---------------------------------------------------------------------------
// teams
// ---------------------------------------------------------------------------

export async function addTeamAction(
  leagueId: string,
  name: string,
  managerName: string,
): Promise<ActionResult> {
  const supabase = await requireUser(leagueId);
  const trimmed = name.trim();

  if (trimmed === "") return { error: "Give the team a name." };

  try {
    await addManualTeam(supabase, leagueId, trimmed, managerName.trim() || null);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

export type TeamFields = {
  name: string;
  managerName: string;
  wins: string;
  losses: string;
  ties: string;
  pointsFor: string;
  faabBalance: string;
};

/** An empty field is "not recorded", which for a record is a real answer. */
function toNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function updateTeamAction(
  leagueId: string,
  teamId: string,
  fields: TeamFields,
): Promise<ActionResult> {
  const supabase = await requireUser(leagueId);
  const name = fields.name.trim();

  if (name === "") return { error: "A team needs a name." };

  try {
    await updateManualTeam(supabase, leagueId, teamId, {
      name,
      managerName: fields.managerName.trim() || null,
      wins: toNumber(fields.wins),
      losses: toNumber(fields.losses),
      ties: toNumber(fields.ties),
      pointsFor: toNumber(fields.pointsFor),
      faabBalance: toNumber(fields.faabBalance),
    });
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

export async function setUsersTeamAction(
  leagueId: string,
  teamId: string,
): Promise<ActionResult> {
  const supabase = await requireUser(leagueId);

  try {
    await setUsersTeam(supabase, leagueId, teamId);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  revalidatePath(`/leagues/${leagueId}/values`);
  revalidatePath(`/leagues/${leagueId}/waivers`);
  return {};
}

export async function deleteTeamAction(
  leagueId: string,
  teamId: string,
): Promise<ActionResult> {
  const supabase = await requireUser(leagueId);

  try {
    await deleteManualTeam(supabase, leagueId, teamId);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

// ---------------------------------------------------------------------------
// rosters
// ---------------------------------------------------------------------------

/**
 * The picker's search, as a server action rather than a route.
 *
 * Searching the master list needs the database and the league's own rosters to
 * annotate the hits with, so it cannot happen in the browser; and it happens on
 * a keystroke, so it cannot be a page navigation. A server action is exactly
 * the shape in between, and it inherits the same RLS session as everything
 * else on the screen.
 */
export async function searchPlayersAction(
  leagueId: string,
  query: string,
): Promise<{ hits: PlayerHit[]; error?: string }> {
  const supabase = await requireUser(leagueId);

  try {
    return { hits: await searchLeaguePlayers(supabase, leagueId, query) };
  } catch (cause) {
    return { hits: [], error: describe(cause) };
  }
}

export async function setRosterEntryAction(
  leagueId: string,
  teamId: string,
  playerId: number,
  slot: string,
): Promise<ActionResult> {
  const supabase = await requireUser(leagueId);

  try {
    await setRosterEntry(supabase, leagueId, teamId, playerId, slot);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

export async function removeRosterEntryAction(
  leagueId: string,
  teamId: string,
  playerId: number,
): Promise<ActionResult> {
  const supabase = await requireUser(leagueId);

  try {
    await removeRosterEntry(supabase, leagueId, teamId, playerId);
  } catch (cause) {
    return { error: describe(cause) };
  }

  refresh(leagueId);
  return {};
}

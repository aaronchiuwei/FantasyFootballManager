import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ManualLeagueForm } from "@/components/leagues/manual-league-form";
import { ManualManageBoard } from "@/components/leagues/manual-manage-board";
import { RosterEditor } from "@/components/leagues/roster-editor";
import type { EditableTeam } from "@/components/leagues/teams-editor";
import { SyncButton } from "@/components/sync/sync-button";
import { latestRun } from "@/lib/sync/run";
import { formatLineup } from "@/lib/leagues/manual-input";
import {
  hasPlayerMaster,
  isManualLeague,
  loadTeamRoster,
  slotOptions,
} from "@/lib/leagues/manual";
import type { RosterSlot } from "@/lib/sources/yahoo-parse";
import { createClient } from "@/lib/supabase/server";

import {
  addTeamAction,
  deleteTeamAction,
  removeRosterEntryAction,
  searchPlayersAction,
  setRosterEntryAction,
  setUsersTeamAction,
  updateSettingsAction,
  updateTeamAction,
} from "./actions";

export const metadata: Metadata = { title: "Manage league" };

/**
 * Where a hand-kept league is actually kept.
 *
 * Three panels, in the order the league is built: what the league is, who
 * plays in it, and who they have. Only the last of those changes weekly, which
 * is why the roster editor is the one with a team selector above it rather
 * than being a screen of its own.
 *
 * Yahoo leagues are turned away at the door rather than 404'd. Their rosters
 * are overwritten wholesale by sync stage 6, so an edit here would vanish at
 * the next sync — and being sent back to the league page with the sync button
 * on it is a more useful answer than "not found".
 */
export default async function ManageLeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { id } = await params;
  const { team: requestedTeam } = await searchParams;

  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();
  if (!isManualLeague(league.source)) redirect(`/leagues/${league.id}`);

  const { data: teamRows } = await supabase
    .from("teams")
    .select(
      "id, name, manager_name, is_users_team, wins, losses, ties, points_for, faab_balance, yahoo_team_id",
    )
    .eq("league_id", league.id)
    .order("yahoo_team_id", { ascending: true, nullsFirst: false });

  const teamIds = (teamRows ?? []).map((row) => row.id);

  const [{ data: rosterRows }, masterReady, run] = await Promise.all([
    teamIds.length === 0
      ? Promise.resolve({ data: [] as { team_id: string }[] })
      : supabase.from("rosters").select("team_id").in("team_id", teamIds),
    hasPlayerMaster(supabase),
    latestRun(supabase, league.id),
  ]);

  const counts = new Map<string, number>();
  for (const row of rosterRows ?? []) {
    counts.set(row.team_id, (counts.get(row.team_id) ?? 0) + 1);
  }

  const teams: EditableTeam[] = (teamRows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    managerName: row.manager_name,
    isUsersTeam: row.is_users_team,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    pointsFor: row.points_for === null ? null : Number(row.points_for),
    faabBalance: row.faab_balance,
    rosterCount: counts.get(row.id) ?? 0,
  }));

  // The team in the URL, this user's own team, or the first one — in that
  // order, so a bare link opens on the roster the manager cares about.
  const selected =
    teams.find((entry) => entry.id === requestedTeam) ??
    teams.find((entry) => entry.isUsersTeam) ??
    teams[0] ??
    null;

  const roster = selected ? await loadTeamRoster(supabase, selected.id) : [];
  const slots = league.roster_slots as unknown as RosterSlot[];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            Manage {league.name}
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground">
            Settings, teams and rosters, kept by hand. Everything else in this
            league is computed from what is on this page.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{league.season}</Badge>
            <Badge variant="outline">{teams.length} teams</Badge>
            <Badge variant="outline">
              {league.num_qbs === 2 ? "Superflex" : "1QB"}
            </Badge>
            <Badge variant="outline">{Number(league.ppr)} PPR</Badge>
          </div>
        </div>

        <SyncButton leagueId={league.id} initialRun={run} />
      </header>

      {masterReady ? null : (
        <Alert>
          <AlertTriangle />
          <AlertTitle>No player list yet</AlertTitle>
          <AlertDescription>
            Rosters are built by picking real players, and the master list
            arrives with the first sync. Run one now — it also pulls the trade
            market and the projections — then come back and fill in the rosters.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <Info />
        <AlertTitle>Changes here are recorded, not repriced</AlertTitle>
        <AlertDescription>
          Values, needs and trade suggestions are computed by a sync. After
          editing settings or rosters, run one so the rest of the league catches
          up.
        </AlertDescription>
      </Alert>

      <ManualLeagueForm
        action={updateSettingsAction.bind(null, league.id)}
        defaults={{
          name: league.name,
          season: league.season,
          ppr: Number(league.ppr),
          scoringLabel: league.scoring_type,
          lineup: formatLineup(slots),
          isDynasty: league.is_dynasty,
          currentWeek: league.current_week,
          startWeek: league.start_week,
          endWeek: league.end_week,
        }}
        submitLabel="Save settings"
        pendingLabel="Saving"
        withTeams={false}
      />

      <ManualManageBoard
        teams={teams}
        selectedTeamId={selected?.id ?? null}
        actions={{
          add: addTeamAction.bind(null, league.id),
          update: updateTeamAction.bind(null, league.id),
          setUsers: setUsersTeamAction.bind(null, league.id),
          remove: deleteTeamAction.bind(null, league.id),
        }}
      >
        {selected ? (
          <RosterEditor
            teamName={selected.name}
            entries={roster}
            slots={slotOptions(slots)}
            disabled={!masterReady}
            actions={{
              search: searchPlayersAction.bind(null, league.id),
              setEntry: setRosterEntryAction.bind(null, league.id, selected.id),
              remove: removeRosterEntryAction.bind(null, league.id, selected.id),
            }}
          />
        ) : null}
      </ManualManageBoard>
    </div>
  );
}

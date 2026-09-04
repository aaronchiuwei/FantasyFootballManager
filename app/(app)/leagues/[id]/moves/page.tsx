import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MoveForm, type RosterPlayer } from "@/components/transactions/move-form";
import { MoveHistory } from "@/components/transactions/move-history";
import { AutoSyncNotice } from "@/components/sync/auto-sync-notice";
import { searchPlayersAction } from "@/app/(app)/leagues/[id]/manage/actions";
import { isManualLeague } from "@/lib/leagues/manual";
import { latestRun } from "@/lib/sync/run";
import { loadMoves } from "@/lib/transactions/store";
import { createClient } from "@/lib/supabase/server";

import { deleteMoveAction, recordMoveAction } from "./actions";

export const metadata: Metadata = { title: "Moves" };

/**
 * The transaction log, and the form that writes to it.
 *
 * Every roster on this league changes here or on the manage screen, and the
 * difference between the two is what the change is *for*. The manage screen is
 * for building a roster — entering a league that already exists. This is for
 * keeping one: a move that happened, on a date, that somebody may want to look
 * back at in November.
 *
 * The rosters of every team are read here rather than on demand, because the
 * trade half of the form needs two of them side by side and a twelve-team
 * league's rosters are a couple of hundred rows.
 */
export default async function MovesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, source, current_week")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();
  if (!isManualLeague(league.source)) redirect(`/leagues/${league.id}`);

  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, name, yahoo_team_id")
    .eq("league_id", league.id)
    .order("yahoo_team_id", { ascending: true, nullsFirst: false });

  const teams = (teamRows ?? []).map((row) => ({ id: row.id, name: row.name }));
  const teamIds = teams.map((team) => team.id);

  const [{ data: rosterRows }, moves, run] = await Promise.all([
    teamIds.length === 0
      ? Promise.resolve({ data: [] })
      : supabase
          .from("rosters")
          .select("team_id, player_id, players (full_name, position)")
          .in("team_id", teamIds),
    loadMoves(supabase, league.id),
    latestRun(supabase, league.id),
  ]);

  type RosterRow = {
    team_id: string;
    player_id: number;
    players: { full_name: string; position: string | null } | null;
  };

  const rosters: Record<string, RosterPlayer[]> = {};
  for (const row of (rosterRows ?? []) as unknown as RosterRow[]) {
    (rosters[row.team_id] ??= []).push({
      playerId: row.player_id,
      name: row.players?.full_name ?? `Player ${row.player_id}`,
      position: row.players?.position ?? null,
    });
  }
  for (const list of Object.values(rosters)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            Moves
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground">
            Adds, drops and trades for {league.name}. Recording one here updates
            the rosters it touches, so the ledger and the board never disagree.
          </p>
        </div>

        <AutoSyncNotice leagueId={league.id} initialRun={run} />
      </header>

      {teams.length < 2 ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>This league has no teams yet</AlertTitle>
          <AlertDescription>
            Add them on the manage screen — a move needs somewhere to move
            players to.
          </AlertDescription>
        </Alert>
      ) : (
        <MoveForm
          teams={teams}
          rosters={rosters}
          currentWeek={league.current_week}
          search={searchPlayersAction.bind(null, league.id)}
          record={recordMoveAction.bind(null, league.id)}
        />
      )}

      <MoveHistory
        moves={moves}
        remove={deleteMoveAction.bind(null, league.id)}
      />
    </div>
  );
}

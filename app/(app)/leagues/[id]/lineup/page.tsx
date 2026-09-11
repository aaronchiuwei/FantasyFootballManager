import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Panel } from "@/components/board/panel";
import { LineupBoard } from "@/components/leagues/lineup-board";
import { ProjectionBoard } from "@/components/lineup/projection-board";
import { StartSitCalls } from "@/components/lineup/start-sit-calls";
import { TeamWeekColumn } from "@/components/lineup/team-week-column";
import { WeekPicker } from "@/components/lineup/week-picker";
import { SyncButton } from "@/components/sync/sync-button";
import { isManualLeague } from "@/lib/leagues/manual";
import { seats } from "@/lib/lineup/assign";
import { loadLineupContext, loadLineupRoster } from "@/lib/lineup/manual";
import { loadWeekBoard, resolveWeek, toWeekLeague } from "@/lib/lineup/store";
import { latestRun } from "@/lib/sync/run";
import { createClient } from "@/lib/supabase/server";

import { autoFillLineupAction, seatPlayerAction } from "./actions";

export const metadata: Metadata = { title: "Start and sit" };

function freshness(timestamp: string | null) {
  if (!timestamp) return "never pulled";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "pulled just now";
  if (hours < 24) return `pulled ${Math.round(hours)}h ago`;
  return `pulled ${Math.round(hours / 24)}d ago`;
}

/**
 * The weekly screen the rest of the app was missing.
 *
 * Everything else here is denominated in rest of season, because everything
 * else here is about assets: what a player is worth, what a roster is short
 * of, what a trade does to a season. None of that answers the question a
 * manager actually asks most often, which is who to start on Sunday - and the
 * weekly projection grid stage 4 has been pulling since Phase 5 was the whole
 * answer sitting unread.
 *
 * So this page reads one week of that grid against every roster in the league,
 * solves each one against the league's own starting slots, and prints the
 * difference between what is slotted and what could be. It is a plain server
 * render: a week is a URL, and the whole board works with no JavaScript.
 */
export default async function LineupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("leagues")
    .select(
      "id, name, season, source, ppr, roster_slots, current_week, start_week, end_week",
    )
    .eq("id", id)
    .maybeSingle();

  if (!row) notFound();

  const manual = isManualLeague(row.source);
  const league = toWeekLeague(row);
  const week = resolveWeek(league, search.week);

  const [board, run] = await Promise.all([
    loadWeekBoard(supabase, { league, week }),
    latestRun(supabase, league.id),
  ]);

  const mine = board.teams.find((team) => team.isUsersTeam) ?? null;

  /**
   * A hand-kept league sets its own lineup, here, for the week on screen.
   *
   * Only here. An imported league's lineup belongs to its provider — stage 7
   * overwrites it on every sync — so this screen tells that manager what to
   * change and leaves the changing to Yahoo or ESPN.
   */
  const editable =
    manual && mine
      ? await (async () => {
          const context = await loadLineupContext(supabase, league.id, week);
          return {
            team: mine,
            roster: await loadLineupRoster(supabase, {
              leagueId: league.id,
              teamId: mine.id,
              ...context,
            }),
            slots: context.slots,
          };
        })()
      : null;
  const rostered = board.teams.reduce(
    (total, team) => total + team.players.length,
    0,
  );
  const projected = board.teams.reduce(
    (total, team) =>
      total + team.players.filter((player) => player.points !== null).length,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            Start and sit
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            One week of the projection grid, read against every roster in the
            league and solved against this league&rsquo;s own starting slots.
            The figure on a name is what he is projected for in week {week}, in
            this league&rsquo;s scoring, not what he is worth. Week {week}{" "}
            projections {freshness(board.projectedAt)}.
          </p>
        </div>

        {manual ? null : <SyncButton leagueId={league.id} initialRun={run} />}
      </div>

      <WeekPicker
        leagueId={league.id}
        weeks={board.weeks}
        week={week}
        currentWeek={board.currentWeek}
        segment="lineup"
      />

      {rostered === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No rosters read yet for the {league.season} season.{" "}
              {manual
                ? "Fill them in on the manage screen and every week of the season opens up here."
                : "One sync pulls every team's players and the week-by-week projections behind them."}
            </p>
            <div className="flex justify-center">
              {manual ? null : (
                <SyncButton
                  leagueId={league.id}
                  initialRun={run}
                  label="Sync this league"
                />
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {board.projectedAt === null ? (
            <Alert>
              <AlertTriangle />
              <AlertTitle>Week {week} has never been projected</AlertTitle>
              <AlertDescription>
                Nothing has been pulled for this week, so every figure below is
                blank and no lineup can be solved. That is a different state
                from a player having no projection, and this page will not
                render one as the other. A sync pulls every week this league
                plays.
              </AlertDescription>
            </Alert>
          ) : projected === 0 ? (
            <Alert>
              <Info />
              <AlertTitle>Nobody on these rosters is projected</AlertTitle>
              <AlertDescription>
                Week {week} was pulled ({board.projectedLines.toLocaleString()}{" "}
                lines landed) but none of them belongs to a rostered player.
                Either identity is unresolved for this league or the week is
                outside the season the grid covers.
              </AlertDescription>
            </Alert>
          ) : null}

          {!board.hasSlate ? (
            <Alert>
              <Info />
              <AlertTitle>No NFL slate for week {week}</AlertTitle>
              <AlertDescription>
                The schedule has not been synced, so nobody is marked on bye and
                no matchup is printed. A player with no projection this week may
                simply be off.
              </AlertDescription>
            </Alert>
          ) : null}

          {editable ? (
            <LineupBoard
              key={`${editable.team.id}:${week}`}
              teamName={editable.team.name}
              week={week}
              seats={seats(editable.roster.players, editable.slots)}
              roster={editable.roster.players}
              basis={editable.roster.basis}
              isSet={editable.roster.stored.size > 0}
              actions={{
                autoFill: autoFillLineupAction.bind(
                  null,
                  league.id,
                  editable.team.id,
                  week,
                ),
                seat: seatPlayerAction.bind(
                  null,
                  league.id,
                  editable.team.id,
                  week,
                ),
              }}
            />
          ) : null}

          {mine ? (
            <StartSitCalls
              team={mine}
              leagueId={league.id}
              week={week}
              played={board.isPlayed}
            />
          ) : (
            <Alert>
              <Info />
              <AlertTitle>No team claimed in this league</AlertTitle>
              <AlertDescription>
                Every roster below still carries its own calls. Claim yours on
                the league page and it moves to the top with the swap spelled
                out.
              </AlertDescription>
            </Alert>
          )}

          <Panel
            label={`Projected points · week ${week} · ${board.teams.length} teams`}
            note={`What each team is set to score this week, ranked. The pale bar behind each one is the best lineup that roster could put out, so the gap is the points sitting on the bench.${board.isPlayed ? " This week has been played; the figure is what the lineup actually scored." : ""}`}
          >
            <ProjectionBoard
              teams={board.teams}
              leagueId={league.id}
              week={week}
              played={board.isPlayed}
            />
          </Panel>

          <Panel
            label={`Lineups · week ${week} · ${rostered} players`}
            note={`Every roster in the league, in standings order. Starters first, then the bench, then reserve. The figure on a name is his week ${week} projection; a name marked Start or Sit is one the optimal lineup disagrees with.${board.hasSlate ? " A player whose team has no game is marked BYE." : ""}`}
          >
            <div className="grid gap-3 lg:grid-cols-2">
              {board.teams.map((team) => (
                <TeamWeekColumn
                  key={team.id}
                  team={team}
                  leagueId={league.id}
                  played={board.isPlayed}
                />
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

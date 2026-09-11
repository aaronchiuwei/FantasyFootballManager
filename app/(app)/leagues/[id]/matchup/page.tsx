import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Panel } from "@/components/board/panel";
import { HeadToHead } from "@/components/matchup/head-to-head";
import { LiveRefresh } from "@/components/matchup/live-refresh";
import { MatchupRail } from "@/components/matchup/matchup-rail";
import { ScheduleEditor } from "@/components/matchup/schedule-editor";
import { WeekPicker } from "@/components/lineup/week-picker";
import { SyncButton } from "@/components/sync/sync-button";
import { isManualLeague } from "@/lib/leagues/manual";
import { resolveWeek, toWeekLeague } from "@/lib/lineup/store";
import { resolveMatchup } from "@/lib/matchups/board";
import { isGameDay } from "@/lib/matchups/live";
import { loadMatchupBoard } from "@/lib/matchups/store";
import { latestRun } from "@/lib/sync/run";
import { createClient } from "@/lib/supabase/server";

import { clearScheduleAction, saveScheduleAction } from "./actions";

export const metadata: Metadata = { title: "Matchup" };

/**
 * The week as an outcome.
 *
 * Every other screen here is about a decision — who to start, what to trade,
 * who to claim — and all of them are denominated in something a manager
 * controls. This one is not. By Sunday afternoon the decisions are made and
 * the only question left is whether they were enough, which is a question
 * about two scores and about how much football is still to be played.
 *
 * All three of those facts were already in the database and none of them had a
 * screen. Stage 6 has been pulling each week's scoreboard since Phase 2 and
 * nothing read the table; stage 5 re-pulls the live week's stat lines on every
 * sync, and the start/sit board deliberately hides them until the week is over
 * because its own question is a forecast. So this page is mostly a join: the
 * schedule row that says who plays whom, against the lineups that say who is
 * left to play.
 *
 * A plain server render, like the board next door. A week is a URL.
 */
export default async function MatchupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string; m?: string }>;
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
    loadMatchupBoard(supabase, { league, week }),
    latestRun(supabase, league.id),
  ]);

  const { pairings } = board;

  // Which one is at full size. The user's own opens by default and the arrows
  // on the panel head walk the rest, so the summary below is a list of the
  // ones *not* on screen rather than a list with a duplicate at the top.
  const shownIndex = resolveMatchup(pairings.length, search.m);
  const shown = pairings[shownIndex] ?? null;
  const others = pairings.filter((_, index) => index !== shownIndex);

  const stepHref = (index: number) =>
    `/leagues/${league.id}/matchup?week=${week}&m=${
      (index + pairings.length) % pairings.length
    }`;

  const rostered = board.board.teams.reduce(
    (total, team) => total + team.players.length,
    0,
  );

  /**
   * Whether live updates are even offered.
   *
   * Three conditions, and the third is the one that stops a Friday polling.
   * The week has to be the live one; something in it has to have started; and
   * there has to be football on *today* — a Thursday night game leaves the
   * whole week reading as live until the clock rolls past it, so without the
   * last check the screen would spend Friday and Saturday asking for changes
   * that cannot happen.
   *
   * The control is only ever offered, never started: it begins paused, and
   * polling is something the user turns on.
   */
  const canGoLive =
    week === board.currentWeek &&
    pairings.some((pairing) => pairing.phase === "live") &&
    isGameDay(board.board.kickoffs);

  /**
   * A hand-kept league types its own schedule in, right here, under whatever
   * it has entered so far.
   *
   * On the screen that draws the schedule rather than on the manage screen
   * with the rest of the manual editing, because a schedule is the one thing
   * about a league that is per week — and the week picker, the pairings it
   * already has and the thing being edited are all on this page. Putting it on
   * manage would mean a second week picker over there and a reason to look in
   * two places.
   */
  const editor =
    manual && board.board.teams.length >= 2 ? (
      <ScheduleEditor
        // Remounted per week. The rows are local state seeded from the week on
        // screen, and without this a move to the next week would reconcile
        // into the same component and leave last week's pairings sitting in
        // selectors labelled with the new one.
        key={`${league.id}:${week}`}
        week={week}
        teams={board.board.teams.map((team) => ({
          id: team.id,
          name: team.name,
        }))}
        existing={pairings.map((pairing) => ({
          a: pairing.a.team.id,
          b: pairing.b?.team.id ?? null,
        }))}
        actions={{
          save: saveScheduleAction.bind(null, league.id, week),
          clear: clearScheduleAction.bind(null, league.id, week),
        }}
      />
    ) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            Matchup
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Week {week} head to head. The large figure is what each side has
            actually banked; under it is where the side finishes if everyone
            still to play hits his projection. The odds between them come from
            that gap and from how much football is left, so they harden through
            the afternoon and settle when the last starter is done.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canGoLive ? <LiveRefresh leagueId={league.id} week={week} /> : null}
          {manual ? null : <SyncButton leagueId={league.id} initialRun={run} />}
        </div>
      </div>

      <WeekPicker
        leagueId={league.id}
        weeks={board.weeks}
        week={week}
        currentWeek={board.currentWeek}
        segment="matchup"
      />

      {rostered === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No rosters read yet for the {league.season} season.{" "}
              {manual
                ? "Fill them in on the manage screen and the weeks open up here."
                : "One sync pulls every team's players, the week-by-week projections behind them, and the schedule that pairs them off."}
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
      ) : pairings.length === 0 ? (
        manual ? null : (
          <Alert>
            <AlertTriangle />
            <AlertTitle>No schedule for week {week}</AlertTitle>
            <AlertDescription>
              Nothing has paired these teams off for this week. The scoreboard
              is pulled for every week this league plays, so an empty one means
              the pull has not run since the league was set up — or that the
              provider has not published this week&rsquo;s pairings yet.
            </AlertDescription>
          </Alert>
        )
      ) : (
        <>
          {board.board.projectedAt === null ? (
            <Alert>
              <Info />
              <AlertTitle>Week {week} has never been projected</AlertTitle>
              <AlertDescription>
                Nothing has been pulled for this week, so nobody still to play
                carries a figure. Scores already banked are unaffected — those
                come from the league itself — but every projected final below is
                only as complete as the men who have already played, and the
                odds should be read as the guess they are.
              </AlertDescription>
            </Alert>
          ) : null}

          {board.mine === null ? (
            <Alert>
              <Info />
              <AlertTitle>No team claimed in this league</AlertTitle>
              <AlertDescription>
                Every matchup in the league is still here, and the arrows walk
                through them. Claim your team on the league page and this opens
                on yours instead of on the top of the table.
              </AlertDescription>
            </Alert>
          ) : null}

          {shown ? (
            <HeadToHead
              pairing={shown}
              leagueId={league.id}
              label={shown.involvesUser ? "Your matchup" : "Matchup"}
              pager={{
                hrefPrev: stepHref(shownIndex - 1),
                hrefNext: stepHref(shownIndex + 1),
                index: shownIndex,
                count: pairings.length,
              }}
            />
          ) : null}

          {others.length > 0 ? (
            <Panel
              label={`Around the league · week ${week} · ${others.length} matchup${others.length === 1 ? "" : "s"}`}
              note="The same two scores and the same odds, without the lineups. A seam far from the centre line is a week already decided; one sitting on it is the game worth watching."
            >
              <div className="flex flex-col gap-2">
                {others.map((pairing) => (
                  <MatchupRail
                    key={pairing.a.team.id}
                    pairing={pairing}
                    href={stepHref(pairings.indexOf(pairing))}
                  />
                ))}
              </div>
            </Panel>
          ) : null}

          {board.unscheduled.length > 0 ? (
            <Alert>
              <Info />
              <AlertTitle>
                {board.unscheduled.length === 1
                  ? "One team is missing from week " + week
                  : `${board.unscheduled.length} teams are missing from week ${week}`}
              </AlertTitle>
              <AlertDescription>
                {board.unscheduled.map((team) => team.name).join(", ")}
                {board.unscheduled.length === 1 ? " appears" : " appear"} on
                this league&rsquo;s roster but in none of week {week}&rsquo;s
                pairings. That is the provider&rsquo;s schedule as we read it,
                not a team we lost.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}

      {editor}
    </div>
  );
}

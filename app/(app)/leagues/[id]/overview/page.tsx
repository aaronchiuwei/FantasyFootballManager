import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Panel } from "@/components/board/panel";
import { SyncButton } from "@/components/sync/sync-button";
import { TeamNeedsCard } from "@/components/needs/team-needs-card";
import { TeamRosterColumn } from "@/components/leagues/team-roster";
import { startingStrength } from "@/lib/needs/needs";
import { loadLeagueNeeds } from "@/lib/needs/store";
import { loadLeagueRosters } from "@/lib/leagues/rosters";
import { latestRun } from "@/lib/sync/run";
import { isManualLeague } from "@/lib/leagues/manual";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "League overview" };

/**
 * §10's staggered card grid. 60ms is long enough to read as a sequence and
 * short enough that the twelfth card lands inside a second — a stagger the user
 * has to wait out is decoration, not comprehension.
 */
const STAGGER_MS = 60;

function freshness(timestamp: string | null) {
  if (!timestamp) return "never computed";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "read just now";
  if (hours < 24) return `read ${Math.round(hours)}h ago`;
  return `read ${Math.round(hours / 24)}d ago`;
}

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, source")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  const manual = isManualLeague(league.source);

  const [needs, rosters, run] = await Promise.all([
    loadLeagueNeeds(supabase, league.id),
    loadLeagueRosters(supabase, league.id),
    latestRun(supabase, league.id),
  ]);

  // Ranked by what the rosters project rather than by the standings, because
  // that is the question this screen answers and the standings are one column
  // away on the league page. Ties fall back to the standings.
  const teams = [...needs.teams].sort((a, b) => {
    const delta = startingStrength(b.needs) - startingStrength(a.needs);
    if (delta !== 0) return delta;
    return (a.rank ?? 99) - (b.rank ?? 99);
  });

  const priced = teams.some((team) => team.needs.length > 0);

  // The roster list is read in standings order rather than by projected
  // strength: it is a reference, and the reader looking someone up is looking
  // for a team by name in the order the league itself prints them.
  const rostered = [...rosters.values()].reduce(
    (total, roster) => total + roster.players.length,
    0,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            League overview
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every roster measured against the other {Math.max(0, teams.length - 1)}{" "}
            at each position. The shape is a standard score, not a point total.
            a vertex inside the dashed ring is a position this league is better
            at than they are. Ranked by projected starters, {freshness(needs.computedAt)}.
          </p>
        </div>

        {manual ? null : <SyncButton leagueId={league.id} initialRun={run} />}
      </div>

      {needs.unresolved > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            {needs.unresolved} rostered player
            {needs.unresolved === 1 ? " is" : "s are"} missing from these shapes
          </AlertTitle>
          <AlertDescription>
            Identity is unresolved for them, so no roster holds them and the
            positions they play read thinner than they are.{" "}
            <Link
              href={`/leagues/${league.id}/identity`}
              className="underline underline-offset-4"
            >
              Resolve them
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {teams.length === 0 || !priced ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No needs vector yet for the {league.season} season. One sync pulls
              the rosters, projects everyone on them, and folds every roster
              against the rest of the league.
            </p>
            <div className="flex justify-center">
              {manual ? null : <SyncButton
                leagueId={league.id}
                initialRun={run}
                label="Sync this league"
              />}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {teams.map((team, index) => (
            <TeamNeedsCard
              key={team.id}
              team={team}
              leagueId={league.id}
              delay={index * STAGGER_MS}
            />
          ))}
        </div>
      )}

      {/* The rosters themselves, under the shapes they produce. The radar says
          what a team is short of; this says who they already have, which is
          the next question every time and until now meant one team at a time
          through the values board. It does not wait on the needs vector,
          because a roster is true as soon as it is read. */}
      {needs.teams.length > 0 ? (
        <Panel
          label={`Rosters · ${needs.teams.length} teams · ${rostered} players`}
          note="Every roster in the league, in standings order. Starters first, then the bench, then reserve. Figures are this league's own player values; open a name for their season and week-by-week stats."
        >
          {rostered === 0 ? (
            <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
              No rosters read yet. {manual
                ? "Fill them in on the manage screen and they appear here."
                : "One sync pulls every team's players."}
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {needs.teams.map((team) => (
                <TeamRosterColumn
                  key={team.id}
                  team={team}
                  roster={rosters.get(team.id)}
                  leagueId={league.id}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

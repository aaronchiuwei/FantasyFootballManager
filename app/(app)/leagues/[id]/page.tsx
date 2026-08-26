import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  AlertTriangle,
  ArrowLeftRight,
  ListPlus,
  Radar,
  Scale,
  Sparkles,
  Users,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SyncPanel } from "@/components/sync/sync-panel";
import { TeamCard, type TeamRow } from "@/components/leagues/team-card";
import { latestRun } from "@/lib/sync/run";
import { createClient } from "@/lib/supabase/server";
import type { RosterSlot } from "@/lib/sources/yahoo";

export const metadata: Metadata = { title: "League" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  const { data: teams } = await supabase
    .from("teams")
    .select(
      "id, name, manager_name, logo_url, is_users_team, wins, losses, ties, points_for, points_against, rank",
    )
    .eq("league_id", league.id)
    .order("rank", { ascending: true, nullsFirst: false });

  // Identity coverage, at a glance: how much of the roster the crosswalk has
  // matched, and how much is waiting on a human (§4).
  const teamIds = (teams ?? []).map((team) => team.id);
  const [
    run,
    { count: matched },
    { count: pending },
    { count: valued },
    { count: marketValued },
    { count: needsCount },
    { count: suggestionCount },
  ] = await Promise.all([
      latestRun(supabase, league.id),
      teamIds.length === 0
        ? Promise.resolve({ count: 0 })
        : supabase
            .from("rosters")
            .select("player_id", { count: "exact", head: true })
            .in("team_id", teamIds),
      supabase
        .from("unmatched_players")
        .select("id", { count: "exact", head: true })
        .eq("league_id", league.id)
        .is("resolved_at", null),
      supabase
        .from("player_values")
        .select("player_id", { count: "exact", head: true })
        .eq("league_id", league.id),
      supabase
        .from("player_values")
        .select("player_id", { count: "exact", head: true })
        .eq("league_id", league.id)
        .eq("value_source", "market"),
      teamIds.length === 0
        ? Promise.resolve({ count: 0 })
        : supabase
            .from("team_needs")
            .select("team_id", { count: "exact", head: true })
            .in("team_id", teamIds),
      supabase
        .from("trade_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("league_id", league.id),
    ]);

  const starters = (league.roster_slots as unknown as RosterSlot[])
    .filter((slot) => slot.isStarting)
    .map((slot) => (slot.count > 1 ? `${slot.count}×${slot.position}` : slot.position));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{league.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{league.season}</Badge>
            <Badge variant="outline">{league.num_teams ?? "?"} teams</Badge>
            {league.scoring_type ? (
              <Badge variant="outline">{league.scoring_type}</Badge>
            ) : null}
            {league.current_week ? (
              <Badge variant="secondary">Week {league.current_week}</Badge>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {league.url ? (
            <Button asChild size="sm" variant="ghost">
              <a href={league.url} target="_blank" rel="noreferrer noopener">
                View on Yahoo
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {league.is_dynasty ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>This looks like a keeper league</AlertTitle>
          <AlertDescription>
            Values here are redraft values. In a keeper or dynasty league they
            will understate young players.
          </AlertDescription>
        </Alert>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="PPR" value={String(league.ppr)} />
        <Stat
          label="QB slots"
          value={league.num_qbs === 2 ? "2 (superflex)" : "1"}
        />
        <Stat label="Starters" value={starters.join(" · ") || "—"} />
        <Stat
          label="Weeks"
          value={
            league.start_week && league.end_week
              ? `${league.start_week}–${league.end_week}`
              : "—"
          }
        />
      </dl>

      <Separator />

      <SyncPanel leagueId={league.id} initialRun={run} />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Player identity</p>
              <p className="text-sm text-muted-foreground">
                {matched === 0
                  ? "No rosters read yet — run a sync to pull them from Yahoo."
                  : `${matched} rostered players matched${
                      pending ? `, ${pending} waiting on a manual match` : ""
                    }.`}
              </p>
            </div>
          </div>

          <Button asChild size="sm" variant="outline">
            <Link href={`/leagues/${league.id}/identity`}>
              {pending ? `Review ${pending}` : "Details"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Scale className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Player values</p>
              <p className="text-sm text-muted-foreground">
                {valued === 0
                  ? "No values yet — a sync prices every roster and the waiver wire."
                  : `${valued?.toLocaleString()} players priced, ${marketValued?.toLocaleString()} straight from the trade market. Open a player for their stats.`}
              </p>
            </div>
          </div>

          <Button asChild size="sm" variant="outline">
            <Link href={`/leagues/${league.id}/values`}>
              {valued ? "Browse" : "Details"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ArrowLeftRight
              className="mt-0.5 size-5 text-muted-foreground"
              aria-hidden
            />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Trade analyzer</p>
              <p className="text-sm text-muted-foreground">
                {valued === 0
                  ? "Needs values — a sync prices every roster first."
                  : `Build a deal between any two of these ${teams?.length ?? 0} teams and read the verdict off the beam.`}
              </p>
            </div>
          </div>

          <Button asChild size="sm" variant="outline">
            <Link href={`/leagues/${league.id}/trade`}>
              {valued ? "Open" : "Details"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Radar className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">League overview</p>
              <p className="text-sm text-muted-foreground">
                {needsCount === 0
                  ? "Needs a sync — every roster is measured against the rest of the league."
                  : `Positional strength for all ${teams?.length ?? 0} teams, and what each of them is short of.`}
              </p>
            </div>
          </div>

          <Button asChild size="sm" variant="outline">
            <Link href={`/leagues/${league.id}/overview`}>
              {needsCount ? "Open" : "Details"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <Sparkles
              className="mt-0.5 size-5 text-muted-foreground"
              aria-hidden
            />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Trade suggestions</p>
              <p className="text-sm text-muted-foreground">
                {suggestionCount === 0
                  ? "Needs a sync — every pair of rosters is searched for a trade that is fair by value and better for both lineups."
                  : `${suggestionCount?.toLocaleString()} trades in this league are fair by value and improve both starting lineups. Or name a player and get the packages that would buy them.`}
              </p>
            </div>
          </div>

          <Button asChild size="sm" variant="outline">
            <Link href={`/leagues/${league.id}/suggestions`}>
              {suggestionCount ? "Open" : "Details"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <ListPlus className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Waiver wire</p>
              <p className="text-sm text-muted-foreground">
                {valued === 0
                  ? "Needs values — a sync pulls and projects the free-agent pool."
                  : "The available pool, ranked on rest-of-season projection and weighted toward what a team is thin at."}
              </p>
            </div>
          </div>

          <Button asChild size="sm" variant="outline">
            <Link href={`/leagues/${league.id}/waivers`}>
              {valued ? "Open" : "Details"}
            </Link>
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Teams ({teams?.length ?? 0})
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          {(teams ?? []).map((team) => (
            <TeamCard
              key={team.id}
              team={team as TeamRow}
              leagueId={league.id}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RefreshLeagueButton } from "@/components/leagues/refresh-league-button";
import { TeamCard, type TeamRow } from "@/components/leagues/team-card";
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

  const starters = (league.roster_slots as unknown as RosterSlot[])
    .filter((slot) => slot.isStarting)
    .map((slot) => (slot.count > 1 ? `${slot.count}×${slot.position}` : slot.position));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/leagues">
          <ArrowLeft className="size-4" aria-hidden />
          All leagues
        </Link>
      </Button>

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
          <RefreshLeagueButton
            leagueId={league.id}
            leagueKey={league.yahoo_league_key}
          />
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

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Teams ({teams?.length ?? 0})
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          {(teams ?? []).map((team) => (
            <TeamCard key={team.id} team={team as TeamRow} />
          ))}
        </div>
      </section>
    </div>
  );
}

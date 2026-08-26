import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRightIcon,
  ListPlus,
  Radar,
  Scale,
  Sparkles,
  Users,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { SyncPanel } from "@/components/sync/sync-panel";
import { TeamCard, type TeamRow } from "@/components/leagues/team-card";
import { latestRun } from "@/lib/sync/run";
import { createClient } from "@/lib/supabase/server";
import type { RosterSlot } from "@/lib/sources/yahoo";

export const metadata: Metadata = { title: "League" };

/** A setting stamped on the board: stencilled label over a tabular figure. */
function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="stencil text-chalk-dim">{label}</dt>
      <dd
        data-numeric
        className="truncate font-plate text-sm font-semibold tabular-nums text-foreground"
      >
        {value}
      </dd>
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

  const teamCount = teams?.length ?? 0;

  /**
   * The board's index. One shape, repeated, because these are seven doors off
   * the same room. Each carries its own live state so the reader can see which
   * doors are open before walking to one.
   */
  const destinations = [
    {
      href: `/leagues/${league.id}/identity`,
      icon: Users,
      label: "Identity",
      title: "Player identity",
      state:
        matched === 0
          ? "No rosters read yet. Run a sync to pull them from Yahoo."
          : `${matched} rostered players matched${
              pending ? `, ${pending} waiting on a manual match` : ""
            }.`,
      cta: pending ? `Review ${pending}` : "Details",
      ready: matched !== 0,
    },
    {
      href: `/leagues/${league.id}/values`,
      icon: Scale,
      label: "Values",
      title: "Player values",
      state:
        valued === 0
          ? "No values yet. A sync prices every roster and the waiver wire."
          : `${valued?.toLocaleString()} players priced, ${marketValued?.toLocaleString()} straight from the trade market.`,
      cta: valued ? "Browse" : "Details",
      ready: Boolean(valued),
    },
    {
      href: `/leagues/${league.id}/trade`,
      icon: ArrowLeftRight,
      label: "Trade",
      title: "Trade analyzer",
      state:
        valued === 0
          ? "Needs values. A sync prices every roster first."
          : `Build a deal between any two of these ${teamCount} teams and read the verdict off the beam.`,
      cta: valued ? "Open" : "Details",
      ready: Boolean(valued),
    },
    {
      href: `/leagues/${league.id}/overview`,
      icon: Radar,
      label: "Overview",
      title: "League overview",
      state:
        needsCount === 0
          ? "Needs a sync. Every roster is measured against the rest of the league."
          : `Positional strength for all ${teamCount} teams, and what each of them is short of.`,
      cta: needsCount ? "Open" : "Details",
      ready: Boolean(needsCount),
    },
    {
      href: `/leagues/${league.id}/suggestions`,
      icon: Sparkles,
      label: "Search",
      title: "Trade suggestions",
      state:
        suggestionCount === 0
          ? "Needs a sync. Every pair of rosters is searched for a trade that is fair by value and better for both lineups."
          : `${suggestionCount?.toLocaleString()} trades here are fair by value and improve both starting lineups.`,
      cta: suggestionCount ? "Open" : "Details",
      ready: Boolean(suggestionCount),
    },
    {
      href: `/leagues/${league.id}/waivers`,
      icon: ListPlus,
      label: "Waivers",
      title: "Waiver wire",
      state:
        valued === 0
          ? "Needs values. A sync pulls and projects the free-agent pool."
          : "The available pool, ranked on rest-of-season projection and weighted toward what a team is thin at.",
      cta: valued ? "Open" : "Details",
      ready: Boolean(valued),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            {league.name}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{league.season}</Badge>
            <Badge variant="outline">{league.num_teams ?? "?"} teams</Badge>
            {league.scoring_type ? (
              <Badge variant="outline">{league.scoring_type}</Badge>
            ) : null}
            {league.current_week ? (
              <Badge>Week {league.current_week}</Badge>
            ) : null}
          </div>
        </div>

        {league.url ? (
          <Button asChild size="sm" variant="ghost">
            <a href={league.url} target="_blank" rel="noreferrer noopener">
              View on Yahoo
            </a>
          </Button>
        ) : null}
      </header>

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

      <Panel label="Settings">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Setting label="PPR" value={String(league.ppr)} />
          <Setting
            label="QB slots"
            value={league.num_qbs === 2 ? "2 (superflex)" : "1"}
          />
          <Setting label="Starters" value={starters.join(" · ") || "Not set"} />
          <Setting
            label="Weeks"
            value={
              league.start_week && league.end_week
                ? `${league.start_week} to ${league.end_week}`
                : "Not set"
            }
          />
        </dl>
      </Panel>

      <SyncPanel leagueId={league.id} initialRun={run} />

      {/* The index. Rails on one continuous board, ruled apart, not six
          identical cards floating in a column. */}
      <Panel label="On this board">
        <ul className="flex flex-col">
          {destinations.map((d, i) => (
            <li key={d.href}>
              <Link
                href={d.href}
                className="group/dest grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3.5 gap-y-1 py-3.5 transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-[color-mix(in_oklch,var(--channel)_32%,transparent)]"
              >
                <d.icon
                  aria-hidden
                  className={[
                    "mt-0.5 size-4 shrink-0 transition-colors duration-(--motion-fast)",
                    d.ready
                      ? "text-grease"
                      : "text-chalk-dim/60",
                  ].join(" ")}
                />

                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="font-plate text-base font-semibold text-foreground">
                      {d.title}
                    </span>
                    <Stencil>{d.label}</Stencil>
                  </div>
                  <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
                    {d.state}
                  </p>
                </div>

                <span className="stencil flex shrink-0 items-center gap-1.5 self-center whitespace-nowrap text-chalk-dim transition-colors duration-(--motion-fast) group-hover/dest:text-grease">
                  {d.cta}
                  <ArrowRightIcon
                    aria-hidden
                    className="size-3.5 transition-transform duration-(--motion-fast) ease-(--ease-out) group-hover/dest:translate-x-0.5"
                  />
                </span>
              </Link>
              {i < destinations.length - 1 ? <RailLine /> : null}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel label={`Teams · ${teamCount}`}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(teams ?? []).map((team) => (
            <TeamCard
              key={team.id}
              team={team as TeamRow}
              leagueId={league.id}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}

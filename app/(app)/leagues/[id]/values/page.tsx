import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SyncButton } from "@/components/sync/sync-button";
import {
  PlayerValueRow,
  type ValueRowData,
} from "@/components/values/player-value-row";
import { latestRun } from "@/lib/sync/run";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Player values" };

/** One screenful of a two-thousand-player board; the rest is what filters are for. */
const PAGE_SIZE = 200;

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

const AVAILABILITY = [
  { key: "all", label: "Everyone" },
  { key: "mine", label: "My team" },
  { key: "rostered", label: "Rostered" },
  { key: "free", label: "Free agents" },
] as const;

type Search = { pos?: string; avail?: string };

function href(leagueId: string, search: Search, patch: Search) {
  const params = new URLSearchParams();
  const merged = { ...search, ...patch };
  if (merged.pos) params.set("pos", merged.pos);
  if (merged.avail && merged.avail !== "all") params.set("avail", merged.avail);
  const query = params.toString();
  return `/leagues/${leagueId}/values${query ? `?${query}` : ""}`;
}

function FilterLink({
  active,
  children,
  ...props
}: React.ComponentProps<typeof Link> & { active: boolean }) {
  return (
    <Link
      {...props}
      className={cn(
        "inline-flex h-7 items-center rounded-4xl border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-lg">{value}</dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function freshness(timestamp: string | null) {
  if (!timestamp) return "never computed";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "computed just now";
  if (hours < 24) return `computed ${Math.round(hours)}h ago`;
  return `computed ${Math.round(hours / 24)}d ago`;
}

export default async function ValuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  const run = await latestRun(supabase, league.id);

  const position = POSITIONS.find((entry) => entry === search.pos?.toUpperCase());
  const availability =
    AVAILABILITY.find((entry) => entry.key === search.avail)?.key ?? "all";

  let query = supabase
    .from("league_player_values")
    .select("*")
    .eq("league_id", league.id)
    .order("overall_rank")
    .limit(PAGE_SIZE);

  if (position) query = query.eq("position", position);
  if (availability === "mine") query = query.eq("is_users_team", true);
  if (availability === "free") query = query.is("team_id", null);
  if (availability === "rostered") query = query.not("team_id", "is", null);

  const counts = (source?: string) => {
    const base = supabase
      .from("player_values")
      .select("player_id", { count: "exact", head: true })
      .eq("league_id", league.id);
    return source ? base.eq("value_source", source) : base;
  };

  const [
    { data: rows, error },
    { count: valued },
    { count: marketCount },
    { count: floorCount },
    { data: newest },
    { count: rosterCount },
    { count: valuedRostered },
  ] = await Promise.all([
    query,
    counts(),
    counts("market"),
    counts("floor"),
    supabase
      .from("player_values")
      .select("computed_at")
      .eq("league_id", league.id)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("rosters")
      .select("player_id, teams!inner(league_id)", { count: "exact", head: true })
      .eq("teams.league_id", league.id),
    supabase
      .from("league_player_values")
      .select("player_id", { count: "exact", head: true })
      .eq("league_id", league.id)
      .not("team_id", "is", null),
  ]);

  const total = valued ?? 0;
  const modelled = total - (marketCount ?? 0) - (floorCount ?? 0);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/leagues/${league.id}`}>
          <ArrowLeft className="size-4" aria-hidden />
          {league.name}
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Player values</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            FantasyCalc prices the top ~192 skill players off real completed
            redraft trades. Everyone below that line is valued from projections
            by value over replacement, calibrated onto the same scale — and
            labelled, so you always know which number you are arguing with.
          </p>
        </div>

        <SyncButton leagueId={league.id} initialRun={run} />
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Valued"
          value={total.toLocaleString()}
          hint={freshness(newest?.computed_at ?? null)}
        />
        <Stat
          label="Market"
          value={(marketCount ?? 0).toLocaleString()}
          hint="FantasyCalc"
        />
        <Stat label="Modelled" value={modelled.toLocaleString()} hint="VOR, calibrated" />
        <Stat
          label="Rostered"
          value={`${(valuedRostered ?? 0).toLocaleString()}/${(rosterCount ?? 0).toLocaleString()}`}
          hint="every roster spot priced"
        />
      </dl>

      {total > 0 && (floorCount ?? 0) > 0 ? (
        <Alert>
          <Info />
          <AlertTitle>
            {floorCount} player{floorCount === 1 ? "" : "s"} carry a nominal value only
          </AlertTitle>
          <AlertDescription>
            No market price and no projection to model from. They are shown as
            unvalued rather than valued at zero, and the trade analyzer will
            refuse a verdict on any trade that includes one.
          </AlertDescription>
        </Alert>
      ) : null}

      <Separator />

      {total === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No values yet for the {league.season} season. One sync pulls the
              market, resolves identity and prices everyone — values are keyed
              to matched players, so the crosswalk runs first either way.
            </p>
            <div className="flex justify-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href={`/leagues/${league.id}/identity`}>Player identity</Link>
              </Button>
              <SyncButton
                leagueId={league.id}
                initialRun={run}
                label="Sync this league"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterLink
                href={href(league.id, search, { pos: undefined })}
                active={!position}
              >
                All
              </FilterLink>
              {POSITIONS.map((entry) => (
                <FilterLink
                  key={entry}
                  href={href(league.id, search, { pos: entry })}
                  active={position === entry}
                >
                  {entry}
                </FilterLink>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {AVAILABILITY.map((entry) => (
                <FilterLink
                  key={entry.key}
                  href={href(league.id, search, { avail: entry.key })}
                  active={availability === entry.key}
                >
                  {entry.label}
                </FilterLink>
              ))}
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not read values</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : (rows ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing matches that filter.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-10 py-2 pr-3 text-right font-medium">#</th>
                    <th className="w-12 py-2 pr-3 text-left font-medium">Pos</th>
                    <th className="py-2 pr-3 text-left font-medium">Player</th>
                    <th className="hidden py-2 pr-3 text-left font-medium sm:table-cell">
                      Owner
                    </th>
                    <th className="hidden py-2 pr-3 text-right font-medium md:table-cell">
                      Proj
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">Value</th>
                    <th className="py-2 text-right font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows ?? []).map((row) => (
                    <PlayerValueRow key={row.player_id} row={row as ValueRowData} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(rows ?? []).length === PAGE_SIZE ? (
            <p className="text-center text-xs text-muted-foreground">
              Showing the top {PAGE_SIZE}. Filter by position to see further down
              the board.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

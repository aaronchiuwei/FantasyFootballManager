import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Info, Search as SearchIcon, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SyncButton } from "@/components/sync/sync-button";
import {
  PlayerValueRow,
  type ValueRowData,
} from "@/components/values/player-value-row";
import { latestRun } from "@/lib/sync/run";
import { isManualLeague } from "@/lib/leagues/manual";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { MIN_QUERY_LENGTH, searchLabel, searchPattern } from "@/lib/values/search";

export const metadata: Metadata = { title: "Player values" };

/** One screenful of a two-thousand-player board; the rest is what filters are for. */
const PAGE_SIZE = 200;

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/** A team id from the query string reaches Postgres as a uuid or not at all. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AVAILABILITY = [
  { key: "all", label: "Everyone" },
  { key: "mine", label: "My team" },
  { key: "rostered", label: "Rostered" },
  { key: "free", label: "Free agents" },
] as const;

type Search = { pos?: string; avail?: string; team?: string; q?: string };

function href(leagueId: string, search: Search, patch: Search) {
  const params = new URLSearchParams();
  const merged = { ...search, ...patch };
  if (merged.pos) params.set("pos", merged.pos);
  if (merged.avail && merged.avail !== "all") params.set("avail", merged.avail);
  if (merged.team) params.set("team", merged.team);
  if (merged.q) params.set("q", merged.q);
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
        "chip",
        active ? "chip-on" : "chip-off",
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
      <dt className="stencil text-chalk-dim">
        {label}
      </dt>
      <dd data-numeric className="font-plate text-xl font-bold tabular-nums text-foreground">
        {value}
      </dd>
      {hint ? (
        <p className="stencil text-chalk-dim/80">{hint}</p>
      ) : null}
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
    .select("id, name, season, source")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  const manual = isManualLeague(league.source);

  const run = await latestRun(supabase, league.id);

  const position = POSITIONS.find((entry) => entry === search.pos?.toUpperCase());
  const availability =
    AVAILABILITY.find((entry) => entry.key === search.avail)?.key ?? "all";
  const teamId = search.team && UUID.test(search.team) ? search.team : null;
  const typed = searchLabel(search.q);
  const pattern = searchPattern(search.q);

  const { data: filteredTeam } = teamId
    ? await supabase
        .from("teams")
        .select("id, name")
        .eq("id", teamId)
        .eq("league_id", league.id)
        .maybeSingle()
    : { data: null };

  let query = supabase
    .from("league_player_values")
    .select("*")
    .eq("league_id", league.id)
    .order("overall_rank")
    .limit(PAGE_SIZE);

  // A name search is the one filter that has to reach past `PAGE_SIZE`: the
  // board is ranked, so "what is he worth" about anybody outside the top 200
  // is otherwise unanswerable. It matches the name as displayed, which is the
  // name the user is looking at — deliberately not §4's normalization, whose
  // job is joining two providers rather than reading a manager's typing.
  if (pattern) query = query.ilike("full_name", pattern);
  if (position) query = query.eq("position", position);
  if (availability === "mine") query = query.eq("is_users_team", true);
  if (availability === "free") query = query.is("team_id", null);
  if (availability === "rostered") query = query.not("team_id", "is", null);
  // One team's roster, which is how a team card reaches its players — and
  // from there their stat pages.
  if (filteredTeam) query = query.eq("team_id", filteredTeam.id);

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">Player values</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            FantasyCalc prices the top ~192 skill players off real completed
            redraft trades. Everyone below that line is valued from projections
            by value over replacement, calibrated onto the same scale, and
            labelled, so you always know which number you are arguing with.
            Open any player for their season and week-by-week stats.
          </p>
        </div>

        {manual ? null : <SyncButton leagueId={league.id} initialRun={run} />}
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
              market, resolves identity and prices everyone. Values are keyed
              to matched players, so the crosswalk runs first either way.
            </p>
            <div className="flex justify-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href={`/leagues/${league.id}/identity`}>Player identity</Link>
              </Button>
              {manual ? null : <SyncButton
                leagueId={league.id}
                initialRun={run}
                label="Sync this league"
              />}
            </div>
          </CardContent>
        </Card>
      ) : (
        <section className="space-y-4">
          {/* A plain GET form, so search is a URL: shareable, back-button
              friendly, and working before any JavaScript has loaded. The other
              filters are already links for the same reason, and this keeps
              them all one mechanism. */}
          <form method="get" className="flex items-center gap-2">
            {position ? <input type="hidden" name="pos" value={position} /> : null}
            {availability !== "all" ? (
              <input type="hidden" name="avail" value={availability} />
            ) : null}
            {filteredTeam ? (
              <input type="hidden" name="team" value={filteredTeam.id} />
            ) : null}

            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <SearchIcon
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                name="q"
                defaultValue={typed}
                placeholder="Find a player by name"
                aria-label="Find a player by name"
                maxLength={60}
                autoComplete="off"
                className="h-9 pl-8"
              />
            </div>

            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>

            {typed ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={href(league.id, search, { q: undefined })}>
                  <X className="size-4" aria-hidden />
                  Clear
                </Link>
              </Button>
            ) : null}
          </form>

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

            {filteredTeam ? (
              <FilterLink
                href={href(league.id, search, { team: undefined })}
                active
              >
                {filteredTeam.name} ✕
              </FilterLink>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not read values</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : (rows ?? []).length === 0 ? (
            /* Three different claims, and they must not render the same way:
               the search was ignored, the search found nobody, or the filters
               did. Only the middle one is a fact about this league. */
            <div className="space-y-2 py-8 text-center text-sm text-muted-foreground">
              {typed && !pattern ? (
                <p>
                  Type at least {MIN_QUERY_LENGTH} letters. A shorter search
                  matches most of the board, so it is not run.
                </p>
              ) : pattern ? (
                <>
                  <p>
                    Nobody priced in this league is called{" "}
                    <span className="font-medium text-foreground">{typed}</span>
                    .
                  </p>
                  <p className="text-xs">
                    The engine prices the market&rsquo;s board, every rostered
                    player and Yahoo&rsquo;s available list. A player outside
                    all three has no row here. If they are on a roster, they may
                    be waiting on the{" "}
                    <Link
                      href={`/leagues/${league.id}/identity`}
                      className="underline underline-offset-4"
                    >
                      identity screen
                    </Link>
                    .
                  </p>
                </>
              ) : (
                <p>Nothing matches that filter.</p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="thead-rail stencil text-chalk-dim">
                    <th className="w-10 py-2 pr-3 text-right font-semibold">#</th>
                    <th className="w-12 py-2 pr-3 text-left font-semibold">Pos</th>
                    <th className="py-2 pr-3 text-left font-semibold">Player</th>
                    <th className="hidden py-2 pr-3 text-left font-semibold sm:table-cell">
                      Owner
                    </th>
                    <th className="hidden py-2 pr-3 text-right font-semibold md:table-cell">
                      Proj
                    </th>
                    <th className="py-2 pr-3 text-right font-semibold">Value</th>
                    <th className="py-2 text-right font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(rows ?? []).map((row) => (
                    <PlayerValueRow
                      key={row.player_id}
                      row={row as ValueRowData}
                      leagueId={league.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(rows ?? []).length === PAGE_SIZE ? (
            <p className="text-center text-xs text-muted-foreground">
              Showing the top {PAGE_SIZE}
              {pattern ? " match" : ""}. {pattern ? "Narrow the search" : "Filter by position"}{" "}
              to see further down the board.
            </p>
          ) : pattern ? (
            <p className="text-center text-xs text-muted-foreground">
              {(rows ?? []).length} match
              {(rows ?? []).length === 1 ? "" : "es"} for{" "}
              <span className="text-foreground">{typed}</span>, ranked as the
              whole board is.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

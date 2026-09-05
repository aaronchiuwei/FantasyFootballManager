import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PlayerHeadshot } from "@/components/players/headshot";
import {
  InjuryBadge,
  injuryDescription,
} from "@/components/players/injury-badge";
import { SeasonSummary } from "@/components/players/season-summary";
import { WeekLineTable } from "@/components/players/week-line-table";
import { PlayerSchedule } from "@/components/schedule/player-schedule";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { loadPlayerDetail, type SeasonCoverage } from "@/lib/players/detail";
import type { SeasonLines } from "@/lib/players/stat-lines";
import { findReading, loadLeagueSos, type LeagueSos } from "@/lib/schedule/store";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Player" };

type Search = { season?: string };

function Stat({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="stencil text-chalk-dim">
        {label}
      </dt>
      <dd
        data-numeric
        className="flex items-center gap-2 font-plate text-xl font-bold tabular-nums text-foreground"
      >
        {value}
        {children}
      </dd>
      {hint ? (
        <p className="stencil text-chalk-dim/80">{hint}</p>
      ) : null}
    </div>
  );
}

/** Which seasons the defense grades behind the schedule panel stand on. */
function gradedOn(sos: LeagueSos): string {
  const older = sos.seasons.filter((year) => year !== sos.season);
  if (sos.liveGames === 0) return `${sos.seasons.join(" and ")} results`;
  return older.length === 0
    ? `${sos.season} results so far`
    : `${sos.season} results so far, pooled with ${older.join(" and ")}`;
}

function freshness(timestamp: string | null) {
  if (!timestamp) return "never pulled";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "pulled just now";
  if (hours < 24) return `pulled ${Math.round(hours)}h ago`;
  return `pulled ${Math.round(hours / 24)}d ago`;
}

/**
 * What a season's numbers actually are, said out loud.
 *
 * §12: it is the preseason, so the current season has projections and nothing
 * else while the prior season has results and nothing else. Rendering both
 * under one unlabelled heading would invite exactly the mistake this line
 * exists to prevent — reading a forecast as a record.
 */
function seasonHint(lines: SeasonLines, coverage: SeasonCoverage | undefined) {
  const weeks = coverage?.actualWeeks ?? 0;
  const pulled = freshness(coverage?.fetchedAt ?? null);

  if (lines.hasActuals) return `Played · ${weeks} week${weeks === 1 ? "" : "s"} of results · ${pulled}`;
  if (lines.hasProjections) return `Projected. No games played yet · ${pulled}`;
  return "Nothing pulled for this season yet";
}

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; playerId: string }>;
  searchParams: Promise<Search>;
}) {
  const { id, playerId } = await params;
  const search = await searchParams;
  const supabase = await createClient();

  const numericPlayerId = Number(playerId);
  if (!Number.isInteger(numericPlayerId)) notFound();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season, ppr, current_week, start_week, end_week")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  // The same fallback stage 1 uses when Sleeper's state is about a different
  // year than the league's, and the same thing it means either way.
  const priorSeason = league.season - 1;

  const [detail, sos] = await Promise.all([
    loadPlayerDetail(supabase, {
      league: { id: league.id, season: league.season, ppr: Number(league.ppr) },
      playerId: numericPlayerId,
      priorSeason,
    }),
    loadLeagueSos(supabase, {
      season: league.season,
      priorSeason,
      ppr: Number(league.ppr),
      currentWeek: league.current_week,
      startWeek: league.start_week,
      endWeek: league.end_week,
    }),
  ]);

  if (!detail) notFound();

  const { player, value, seasons, coverage } = detail;
  const [current, prior] = seasons;

  const reading = (key: "season" | "ros" | "playoffs") =>
    findReading(sos.windows[key].readings, player.nfl_team, player.position);

  // Keyed by week for the game log, which asks about one row at a time. Only
  // the current season gets one: the slate for a finished season is knowable,
  // but the team this player lined up for in week 6 of it is not -- the master
  // carries the team he is on today, and that is the whole reason the defense
  // grades are folded from a source that names both sides of every game.
  const matchups = new Map(
    (reading("season")?.weeks ?? []).map((week) => [week.week, week]),
  );

  // An explicit click on the season toggle always wins, even onto an empty
  // grid — a switch that silently refuses is worse than an honest blank.
  // Otherwise default to the first season that has anything, which before
  // kickoff is the current one's projection grid.
  const requested = Number(search.season);
  const shown =
    seasons.find((entry) => entry.season === requested) ??
    seasons.find((entry) => entry.weeks.length > 0) ??
    current;

  const logHref = (season: number) =>
    `/leagues/${league.id}/players/${player.id}?season=${season}`;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/leagues/${league.id}/values`}>
          <ArrowLeft className="size-4" aria-hidden />
          Player values
        </Link>
      </Button>

      <div className="flex flex-wrap items-start gap-4">
        <PlayerHeadshot
          src={player.headshot_url}
          name={player.full_name}
          size="lg"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
              {player.full_name}
            </h1>
            <PositionBadge position={player.position} />
            <InjuryBadge
              status={player.injury_status}
              note={value?.injury_note}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{player.nfl_team ?? "Free agent"}</Badge>
            {player.age === null ? null : (
              <Badge variant="outline">{Math.round(Number(player.age))} yrs</Badge>
            )}
            {player.years_exp === null ? null : (
              <Badge variant="outline">
                {player.years_exp === 0 ? "Rookie" : `${player.years_exp} yr exp`}
              </Badge>
            )}
            {value?.team_name ? (
              <Badge variant={value.is_users_team ? "secondary" : "outline"}>
                {value.team_name}
                {value.slot ? ` · ${value.slot}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline">Free agent</Badge>
            )}
          </div>

          {/*
            The badge is two letters because a table row has no width for more.
            This page does, so the status gets spelled out and Yahoo's note --
            the *why* Sleeper's status never says -- gets printed next to it.
          */}
          {injuryDescription(player.injury_status, value?.injury_note) ? (
            <p className="stencil text-destructive">
              {injuryDescription(player.injury_status, value?.injury_note)}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Value"
          value={value ? value.value.toLocaleString() : "--"}
          hint={value ? undefined : "not priced in this league"}
        >
          {value ? <ValueBadge source={value.value_source} /> : null}
        </Stat>
        <Stat
          label="Rank"
          value={value?.overall_rank ? `#${value.overall_rank}` : "--"}
          hint={
            value?.position_rank
              ? `${player.position ?? "--"}${value.position_rank}`
              : undefined
          }
        />
        <Stat
          label={`${league.season} projected`}
          value={
            current.total.projected === null
              ? "--"
              : current.total.projected.toFixed(1)
          }
          hint="full season, this league's scoring"
        />
        <Stat
          label={`${priorSeason} actual`}
          value={
            prior.total.actual === null ? "--" : prior.total.actual.toFixed(1)
          }
          hint={
            prior.total.gamesPlayed
              ? `${prior.total.gamesPlayed} games`
              : "no results stored"
          }
        />
      </dl>

      {value === null ? (
        <Alert>
          <Info />
          <AlertTitle>This player has no value in this league</AlertTitle>
          <AlertDescription>
            The value engine prices the market&apos;s board, every rostered
            player and the projected free-agent pool. Anyone outside that is
            shown without a number rather than being valued at zero.
          </AlertDescription>
        </Alert>
      ) : null}

      <Separator />

      <section className="grid gap-3 sm:grid-cols-2">
        <SeasonSummary
          lines={current}
          label={`${league.season} season`}
          hint={seasonHint(current, coverage.get(league.season))}
        />
        <SeasonSummary
          lines={prior}
          label={`${priorSeason} season`}
          hint={seasonHint(prior, coverage.get(priorSeason))}
        />
      </section>

      <PlayerSchedule
        position={player.position}
        nflTeam={player.nfl_team}
        season={league.season}
        currentWeek={league.current_week}
        restOfSeason={reading("ros")}
        playoffs={reading("playoffs")}
        weeks={reading("season")?.weeks ?? []}
        gradedOn={gradedOn(sos)}
      />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="stencil text-chalk-dim">
            Week by week
          </h2>

          <div className="flex items-center gap-1.5">
            {[league.season, priorSeason].map((season) => (
              <Link
                key={season}
                href={logHref(season)}
                className={cn(
                  "chip",
                  season === shown.season
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {season}
              </Link>
            ))}
          </div>
        </div>

        {shown.weeks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No weekly lines stored for {shown.season}. A sync pulls the
              projection grid for this league&apos;s own week window, and the
              prior season&apos;s game log once. That one never changes, so it
              is never pulled twice.
            </CardContent>
          </Card>
        ) : (
          <>
            <WeekLineTable
              lines={shown}
              position={player.position}
              matchups={
                shown.season === league.season && matchups.size > 0
                  ? matchups
                  : undefined
              }
            />
            <p className="max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
              {shown.hasActuals
                ? "Weeks that have been played show what happened; the box score follows the actual line."
                : `Every week here is a projection. The ${shown.season} season has not started. The box score follows the projected line.`}
              {shown.season === league.season
                ? null
                : " There is no opponent column on a past season: the slate is known, but which team he lined up for in a given week of it is not."}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

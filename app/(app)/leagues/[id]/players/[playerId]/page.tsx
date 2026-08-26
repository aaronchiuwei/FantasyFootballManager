import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { InjuryBadge } from "@/components/players/injury-badge";
import { SeasonSummary } from "@/components/players/season-summary";
import { WeekLineTable } from "@/components/players/week-line-table";
import { PositionBadge } from "@/components/values/position-badge";
import { ValueBadge } from "@/components/values/value-badge";
import { loadPlayerDetail, type SeasonCoverage } from "@/lib/players/detail";
import type { SeasonLines } from "@/lib/players/stat-lines";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Player" };

type Search = { season?: string };

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

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
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="flex items-center gap-2 font-mono text-lg">
        {value}
        {children}
      </dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
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
  if (lines.hasProjections) return `Projected — no games played yet · ${pulled}`;
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
    .select("id, name, season, ppr")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  // The same fallback stage 1 uses when Sleeper's state is about a different
  // year than the league's, and the same thing it means either way.
  const priorSeason = league.season - 1;

  const detail = await loadPlayerDetail(supabase, {
    league: { id: league.id, season: league.season, ppr: Number(league.ppr) },
    playerId: numericPlayerId,
    priorSeason,
  });

  if (!detail) notFound();

  const { player, value, seasons, coverage } = detail;
  const [current, prior] = seasons;

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
        <Avatar className="size-16 shrink-0">
          {player.headshot_url ? (
            <AvatarImage src={player.headshot_url} alt="" />
          ) : null}
          <AvatarFallback>{initials(player.full_name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {player.full_name}
            </h1>
            <PositionBadge position={player.position} />
            <InjuryBadge status={player.injury_status} />
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
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Value"
          value={value ? value.value.toLocaleString() : "—"}
          hint={value ? undefined : "not priced in this league"}
        >
          {value ? <ValueBadge source={value.value_source} /> : null}
        </Stat>
        <Stat
          label="Rank"
          value={value?.overall_rank ? `#${value.overall_rank}` : "—"}
          hint={
            value?.position_rank
              ? `${player.position ?? "—"}${value.position_rank}`
              : undefined
          }
        />
        <Stat
          label={`${league.season} projected`}
          value={
            current.total.projected === null
              ? "—"
              : current.total.projected.toFixed(1)
          }
          hint="full season, this league's scoring"
        />
        <Stat
          label={`${priorSeason} actual`}
          value={
            prior.total.actual === null ? "—" : prior.total.actual.toFixed(1)
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Week by week
          </h2>

          <div className="flex items-center gap-1.5">
            {[league.season, priorSeason].map((season) => (
              <Link
                key={season}
                href={logHref(season)}
                className={cn(
                  "inline-flex h-7 items-center rounded-4xl border px-3 text-xs font-medium transition-colors motion-reduce:transition-none",
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
              prior season&apos;s game log once — that one never changes, so it
              is never pulled twice.
            </CardContent>
          </Card>
        ) : (
          <>
            <WeekLineTable lines={shown} position={player.position} />
            <p className="text-xs text-muted-foreground">
              {shown.hasActuals
                ? "Weeks that have been played show what happened; the box score follows the actual line."
                : `Every week here is a projection — the ${shown.season} season has not started. The box score follows the projected line.`}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

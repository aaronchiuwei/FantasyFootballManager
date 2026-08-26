import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { startingStrength, topNeeds, topSurpluses } from "@/lib/needs/needs";
import type { LeagueNeedsTeam } from "@/lib/needs/store";
import { cn } from "@/lib/utils";

import { NeedChip } from "./need-chip";
import { NeedsRadar } from "./needs-radar";

function record(team: LeagueNeedsTeam) {
  if (team.wins === null && team.losses === null) return "No games played";
  const base = `${team.wins ?? 0}-${team.losses ?? 0}`;
  return team.ties ? `${base}-${team.ties}` : base;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * §10's league-overview card: "a positional strength radar plus the two largest
 * surpluses and two largest needs, sourced straight from the needs vector."
 *
 * The entrance is staggered by the caller through `delay`. It is a CSS
 * animation rather than a spring, so `motion-reduce:animate-none` cancels it
 * outright — under reduced motion twelve cards simply appear, which is the same
 * information without the wait (§10).
 */
export function TeamNeedsCard({
  team,
  leagueId,
  delay,
}: {
  team: LeagueNeedsTeam;
  leagueId: string;
  delay: number;
}) {
  const needs = topNeeds(team.needs);
  const surpluses = topSurpluses(team.needs);
  const strength = startingStrength(team.needs);

  // A team whose confidence is short somewhere is a team the vector could not
  // see whole. The lowest position is the honest one to report.
  const confidence = team.needs.reduce(
    (lowest, row) => Math.min(lowest, row.confidence),
    1,
  );

  return (
    <Card
      style={{ animationDelay: `${delay}ms` }}
      className={cn(
        "animate-in fade-in slide-in-from-bottom-2 duration-(--motion-base) ease-(--ease-out) motion-reduce:animate-none",
        team.isUsersTeam && "border-primary/60 bg-primary/5",
      )}
    >
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <Avatar className="size-9 shrink-0">
            {team.logoUrl ? <AvatarImage src={team.logoUrl} alt="" /> : null}
            <AvatarFallback className="text-xs">
              {initials(team.name)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              {/* The roster behind the shape, as a filtered values board. */}
              <Link
                href={`/leagues/${leagueId}/values?team=${team.id}`}
                className="truncate font-medium underline-offset-4 hover:underline"
              >
                {team.name}
              </Link>
              {team.isUsersTeam ? (
                <Badge variant="secondary" className="shrink-0">
                  You
                </Badge>
              ) : null}
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {team.rank ? `#${team.rank} · ` : ""}
              {record(team)}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="font-mono text-lg tabular-nums">
              {Math.round(strength).toLocaleString()}
            </p>
            <p className="text-[0.6875rem] text-muted-foreground">
              proj. starters
            </p>
          </div>
        </div>

        {team.needs.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No needs vector yet. A sync reads every roster.
          </p>
        ) : (
          <>
            <div className="flex justify-center">
              <NeedsRadar needs={team.needs} label={team.name} />
            </div>

            <dl className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <dt className="w-14 shrink-0 text-muted-foreground">Needs</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {needs.length === 0 ? (
                    <span className="text-muted-foreground">
                      average or better everywhere
                    </span>
                  ) : (
                    needs.map((row) => (
                      <NeedChip
                        key={row.position}
                        position={row.position}
                        z={row.need}
                        kind="need"
                      />
                    ))
                  )}
                </dd>
              </div>

              <div className="flex items-center gap-2">
                <dt className="w-14 shrink-0 text-muted-foreground">Depth</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {surpluses.length === 0 ? (
                    <span className="text-muted-foreground">
                      nothing spare to trade
                    </span>
                  ) : (
                    surpluses.map((row) => (
                      <NeedChip
                        key={row.position}
                        position={row.position}
                        z={row.surplusZ}
                        kind="surplus"
                      />
                    ))
                  )}
                </dd>
              </div>
            </dl>

            {confidence < 1 ? (
              <p className="text-[0.6875rem] text-muted-foreground">
                {Math.round((1 - confidence) * 100)}% of one position has no
                projection, so this shape understates it.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

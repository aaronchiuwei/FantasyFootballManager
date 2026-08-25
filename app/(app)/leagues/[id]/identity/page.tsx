import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ResolveIdentitiesButton } from "@/components/players/resolve-identities-button";
import { UnmatchedPlayerCard } from "@/components/players/unmatched-player-card";
import { getIdentityStatus } from "@/lib/crosswalk/store";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Player identity" };

/** §13: the crosswalk has to auto-resolve at least this share of a roster. */
const TARGET_RATE = 95;

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
  if (!timestamp) return "never synced";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "updated just now";
  if (hours < 24) return `updated ${Math.round(hours)}h ago`;
  return `updated ${Math.round(hours / 24)}d ago`;
}

export default async function IdentityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  const status = await getIdentityStatus(league.id);
  const pendingRostered = status.unmatched.filter(
    (entry) => entry.payload.teamKey !== null,
  ).length;
  const totalRostered = status.rostered + pendingRostered;
  const rate =
    totalRostered === 0
      ? null
      : Math.round((status.rostered / totalRostered) * 1000) / 10;

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
          <h1 className="text-2xl font-semibold tracking-tight">
            Player identity
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Yahoo and the value sources have no shared player id, so every
            player is matched through a ladder: DynastyProcess&apos;s crosswalk,
            Sleeper&apos;s own ids, then name + position + team. Anything the
            ladder cannot settle lands here rather than being guessed at.
          </p>
        </div>

        <ResolveIdentitiesButton leagueId={league.id} />
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Auto-resolved"
          value={rate === null ? "—" : `${rate}%`}
          hint={`target ${TARGET_RATE}%`}
        />
        <Stat
          label="Rostered"
          value={`${status.rostered}/${totalRostered}`}
          hint="matched to a player"
        />
        <Stat
          label="Needs a match"
          value={String(status.unmatched.length)}
          hint="one click each"
        />
        <Stat
          label="Player master"
          value={status.playersInMaster.toLocaleString()}
          hint={freshness(status.masterUpdatedAt)}
        />
      </dl>

      {rate !== null && rate < TARGET_RATE ? (
        <Alert>
          <Info />
          <AlertTitle>Below the {TARGET_RATE}% target</AlertTitle>
          <AlertDescription>
            Resolve the players below — every one of them would otherwise be
            missing from trade math, and a missing player is never valued at
            zero here.
          </AlertDescription>
        </Alert>
      ) : null}

      <Separator />

      {totalRostered === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No rosters have been read yet for this league.
            </p>
            <div className="flex justify-center">
              <ResolveIdentitiesButton
                leagueId={league.id}
                label="Pull rosters and resolve"
              />
            </div>
          </CardContent>
        </Card>
      ) : status.unmatched.length === 0 ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Everyone is matched</AlertTitle>
          <AlertDescription>
            Every rostered player and free agent in this league resolves to a
            player in the master list.
          </AlertDescription>
        </Alert>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Unmatched ({status.unmatched.length})
          </h2>

          <div className="space-y-3">
            {status.unmatched.map((entry) => (
              <UnmatchedPlayerCard
                key={entry.id}
                leagueId={league.id}
                entry={entry}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

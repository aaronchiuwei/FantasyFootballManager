import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SyncButton } from "@/components/sync/sync-button";
import { WaiverBoard } from "@/components/waivers/waiver-board";
import { ArrowLeft } from "lucide-react";
import { latestRun } from "@/lib/sync/run";
import { loadWaiverBoard } from "@/lib/waivers/store";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Waiver wire" };

function freshness(timestamp: string | null) {
  if (!timestamp) return "never pulled";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "pulled just now";
  if (hours < 24) return `pulled ${Math.round(hours)}h ago`;
  return `pulled ${Math.round(hours / 24)}d ago`;
}

export default async function WaiversPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  const [board, run] = await Promise.all([
    loadWaiverBoard(supabase, league.id),
    latestRun(supabase, league.id),
  ]);

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
          <h1 className="text-2xl font-semibold tracking-tight">Waiver wire</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Ranked on rest-of-season projection, not on trade value — free
            agents sit below the coverage of the market, so sorting them by an
            estimated price would be sorting on noise. Values still ride along
            with their source. {board.players.length.toLocaleString()} available
            in Yahoo, {freshness(board.fetchedAt)}.
          </p>
        </div>

        <SyncButton leagueId={league.id} initialRun={run} />
      </div>

      {board.players.length > 0 && !board.hasNeeds ? (
        <Alert>
          <Info />
          <AlertTitle>No needs vector yet</AlertTitle>
          <AlertDescription>
            Every position is being weighted the same, so this is a straight
            projection ranking. A sync reads each roster against the rest of the
            league and the wire starts leaning toward what this team is thin at.
          </AlertDescription>
        </Alert>
      ) : null}

      {board.players.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No free agents for the {league.season} season yet. A sync pulls
              the top of the available list from Yahoo, matches every one of
              them to a player, and projects the rest of their season.
            </p>
            <div className="flex justify-center">
              <SyncButton
                leagueId={league.id}
                initialRun={run}
                label="Sync this league"
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <WaiverBoard leagueId={league.id} board={board} />
      )}
    </div>
  );
}

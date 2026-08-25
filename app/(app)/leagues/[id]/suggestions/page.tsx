import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BuilderPanel } from "@/components/suggestions/builder-panel";
import { CycleBoard } from "@/components/suggestions/cycle-board";
import { WinWinBoard } from "@/components/suggestions/win-win-board";
import { SyncButton } from "@/components/sync/sync-button";
import { loadSuggestionsBoard } from "@/lib/suggestions/store";
import { latestRun } from "@/lib/sync/run";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Trade suggestions" };

function freshness(timestamp: string | null) {
  if (!timestamp) return "never searched";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "searched just now";
  if (hours < 24) return `searched ${Math.round(hours)}h ago`;
  return `searched ${Math.round(hours / 24)}d ago`;
}

export default async function SuggestionsPage({
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

  const [suggestions, run] = await Promise.all([
    loadSuggestionsBoard(supabase, league.id),
    latestRun(supabase, league.id),
  ]);

  const { board } = suggestions;
  const tradeable = board.teams.length >= 2 && board.assets.length > 0;

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
            Trade suggestions
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every trade in this league that is fair by value{" "}
            <em>and</em> leaves both starting lineups better than it found them,
            ranked by whichever side gains less. Fair alone gives you trades
            nobody wants; better-for-you alone gives you trades nobody accepts.{" "}
            {suggestions.suggestions.length.toLocaleString()} survive both,{" "}
            {freshness(suggestions.computedAt)}.
          </p>
        </div>

        <SyncButton leagueId={league.id} initialRun={run} />
      </div>

      {board.unresolved > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            {board.unresolved} rostered player
            {board.unresolved === 1 ? " is" : "s are"} not in this search
          </AlertTitle>
          <AlertDescription>
            Identity is unresolved for them, so they have no value and no
            package can contain them.{" "}
            <Link
              href={`/leagues/${league.id}/identity`}
              className="underline underline-offset-4"
            >
              Resolve them
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {!tradeable ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing to search yet for the {league.season} season. A sync pulls
              every roster, prices everyone on them, reads what each team is
              short of, and only then can look for a trade that helps two teams
              at once.
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
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Win-win trades
            </h2>
            <WinWinBoard
              leagueId={league.id}
              teams={suggestions.teams}
              suggestions={suggestions.suggestions}
            />
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">
                Build around a player
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Name someone on another roster and this prices them, then offers
                a few different ways to meet that price — drawn from the
                positions this team is deep at, and keeping back the ones it is
                thin at.
              </p>
            </div>
            <BuilderPanel leagueId={league.id} board={board} />
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">
                Three-team trades
              </h2>
              <p className="max-w-2xl text-sm text-muted-foreground">
                A cycle: you give to one manager, they give to another, the
                third gives back to you. Nobody trades with anybody directly,
                which is the whole reason these exist — they are the deal to
                make when the manager who has what you want does not want what
                you have. Every leg is priced on its own, because a ring that
                balances overall can still be robbing one of the three.
              </p>
            </div>
            <CycleBoard
              leagueId={league.id}
              teams={suggestions.teams}
              cycles={suggestions.cycles}
              // A cycle menu is empty far more often than it is full, so
              // "searched and found none" has to be distinguishable from "never
              // searched". The value board's own timestamp is the honest signal:
              // stage 8 computes both, so if there are values there was a search.
              searched={board.computedAt !== null}
            />
          </section>
        </>
      )}
    </div>
  );
}

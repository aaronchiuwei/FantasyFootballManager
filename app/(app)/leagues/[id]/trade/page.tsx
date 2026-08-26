import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { SyncButton } from "@/components/sync/sync-button";
import {
  TradeAnalyzer,
  type InitialTrade,
} from "@/components/trade/trade-analyzer";
import type { SavedTradeView } from "@/components/trade/saved-trades";
import { latestRun } from "@/lib/sync/run";
import { loadSavedTrades, loadTradeBoard } from "@/lib/trades/store";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Trade analyzer" };

function freshness(timestamp: string | null) {
  if (!timestamp) return "never computed";
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "priced just now";
  if (hours < 24) return `priced ${Math.round(hours)}h ago`;
  return `priced ${Math.round(hours / 24)}d ago`;
}

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * A trade handed over in the URL, which is how Phase 8's suggestion cards open
 * one here: `?ta=…&tb=…&a=1,2&b=3`. Ids only — never totals — so what the
 * analyzer prices is its own arithmetic over its own board, exactly as it is
 * when the user drags the players in by hand.
 */
function initialTrade(
  query: Record<string, string | string[] | undefined>,
): InitialTrade | null {
  const teamA = one(query.ta);
  const teamB = one(query.tb);
  if (!teamA || !teamB || teamA === teamB) return null;

  const ids = (value: string | undefined): number[] =>
    (value ?? "")
      .split(",")
      .map((entry) => Number.parseInt(entry, 10))
      .filter((entry) => Number.isSafeInteger(entry) && entry > 0);

  const a = ids(one(query.a));
  const b = ids(one(query.b));
  if (a.length === 0 && b.length === 0) return null;

  return { teamA, teamB, a, b };
}

export default async function TradePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name, season")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  const [board, saved, run] = await Promise.all([
    loadTradeBoard(supabase, league.id),
    loadSavedTrades(supabase, league.id),
    latestRun(supabase, league.id),
  ]);

  const trades: SavedTradeView[] = saved.map((record) => ({
    id: record.id,
    note: record.note,
    createdAt: record.createdAt,
    snapshot: record.snapshot,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Trade analyzer
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Both packages are summed at their market value, then adjusted for
            who holds the best player and how many roster spots the deal fills.
            The beam is the verdict. {board.assets.length.toLocaleString()}{" "}
            rostered players, {freshness(board.computedAt)}.
          </p>
        </div>

        <SyncButton leagueId={league.id} initialRun={run} />
      </div>

      {board.unresolved > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            {board.unresolved} rostered player
            {board.unresolved === 1 ? " is" : "s are"} not on the board
          </AlertTitle>
          <AlertDescription>
            Identity is unresolved for them, so they have no value and cannot
            appear in a trade — which is the point: a missing value must never
            be summed as a zero.{" "}
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

      {board.teams.length === 0 || board.assets.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing to trade yet for the {league.season} season. A sync pulls
              the rosters from Yahoo and prices every player on them — the
              analyzer runs entirely on those cached values.
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
        <TradeAnalyzer
          leagueId={league.id}
          board={board}
          saved={trades}
          initial={initialTrade(query)}
        />
      )}
    </div>
  );
}

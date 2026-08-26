import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { GreaseNote, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { SiteHeader } from "@/components/board/site-header";
import {
  OpenTradeAnalyzer,
  type OpenTrade,
} from "@/components/trade/open-trade-analyzer";
import { MAX_SIDE_NAME } from "@/components/trade/open-trade-side";
import { loadOpenBoard } from "@/lib/trades/open-board";
import { parseIds, parseScoring, scoringLabel } from "@/lib/trades/open-market";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Trade analyzer",
  description:
    "Price any two packages against the redraft trade market. No league import, no account.",
};

/** The board is pulled live when the cache is cold, so this cannot be static. */
export const dynamic = "force-dynamic";

function freshness(timestamp: string | null) {
  if (!timestamp) return null;
  const hours = (Date.now() - Date.parse(timestamp)) / 3_600_000;
  if (hours < 1) return "priced within the hour";
  if (hours < 24) return `priced ${Math.round(hours)}h ago`;
  return `priced ${Math.round(hours / 24)}d ago`;
}

function sideName(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  // A shared link's label is a stranger's text. React escapes it on the way
  // out; the length cap is so it cannot shove the panel head off the screen.
  return (raw ?? "").trim().slice(0, MAX_SIDE_NAME);
}

/**
 * The trade analyzer, before there is a league (§6, §1).
 *
 * Requirement 1 gets the rosters out of Yahoo, and every screen behind it is
 * better for that: real ownership, a needs vector, a lineup delta. But the
 * question that brings people to a tool like this — *is this trade fair* — does
 * not need any of it, and putting an OAuth handshake and a nine-stage sync in
 * front of it means the answer arrives only for people who were already
 * convinced.
 *
 * So this page runs the same `analyzeTrade` on the same market values against
 * two packages typed in by hand. What it cannot do without a league it does
 * not pretend to do, and says which is which in writing below the board.
 */
export default async function OpenTradePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const scoring = parseScoring(query);

  const supabase = await createClient();
  const [{ data: { user } }, board] = await Promise.all([
    supabase.auth.getUser(),
    loadOpenBoard(scoring),
  ]);

  const known = new Set(board.assets.map((asset) => asset.playerId));
  const onBoard = (ids: number[]) => ids.filter((id) => known.has(id));

  // Same rule the league analyzer applies to a suggestion link: ids are
  // checked against the board rather than trusted, so a link built on last
  // week's board opens an emptier trade rather than a half-real one.
  const initial: OpenTrade = {
    picks: {
      a: onBoard(parseIds(query.a)),
      b: onBoard(parseIds(query.b)),
    },
    names: { a: sideName(query.na), b: sideName(query.nb) },
  };

  const priced = freshness(board.fetchedAt);

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader signedIn={Boolean(user)} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
              Trade analyzer
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Put players on both sides and get a verdict. Both packages are
              summed at their market value, then adjusted for who holds the best
              player and how many roster spots the deal fills. No league import,
              no account.{" "}
              <span className="text-chalk-dim">
                {scoringLabel(board.scoring)}
                {priced ? ` · ${priced}` : ""}
              </span>
            </p>
          </div>

          <Button asChild variant="outline" size="sm">
            <Link href={user ? "/leagues" : "/signup"}>
              {user ? "Your leagues" : "Connect Yahoo"}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>

        {board.assets.length === 0 ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>The market board is empty right now</AlertTitle>
            <AlertDescription>
              FantasyCalc could not be reached and nothing was cached for a{" "}
              {scoringLabel(board.scoring)} league, so there are no values to
              price a trade with. Rather than sum numbers we do not have, the
              analyzer shows nothing. Try again in a few minutes.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {board.stale ? (
              <Alert className="mb-4">
                <AlertTriangle />
                <AlertTitle>These values are the last good ones</AlertTitle>
                <AlertDescription>
                  FantasyCalc could not be reached, so this board is what it
                  said {priced}. The verdict is real; its freshness is not.
                </AlertDescription>
              </Alert>
            ) : null}

            <OpenTradeAnalyzer board={board} initial={initial} />
          </>
        )}

        {/* What this page is not. The league analyzer knows three things this
            one cannot, and a manager deciding on a trade deserves to know
            which of them is missing from the verdict they just read. */}
        <section className="mt-10">
          <RailLine />
          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
            <div className="space-y-3">
              <h2 className="max-w-[20ch] text-balance font-plate text-2xl leading-tight font-bold tracking-[-0.01em] text-foreground">
                What a league adds to this.
              </h2>
              <p className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
                This verdict is the market&rsquo;s opinion of two packages. Import a
                Yahoo league and the same screen also knows whose roster they
                come off.
              </p>
              <Button asChild size="sm">
                <Link href={user ? "/leagues" : "/signup"}>
                  {user ? "Import a league" : "Get started"}
                </Link>
              </Button>
            </div>

            <ul className="flex flex-col gap-4">
              {[
                [
                  "Roster context",
                  "What each side's starting lineup projects before and after the deal, solved against your league's own slots.",
                ],
                [
                  "Needs",
                  "A needs vector per team, so a verdict can say what the trade fixes rather than only who wins it.",
                ],
                [
                  "Search",
                  "Win-win trades across the whole league, packages built around one player, and three-team cycles.",
                ],
                [
                  "Everyone else",
                  "Players the market does not price get a modelled value calibrated onto your league — here they are simply absent.",
                ],
              ].map(([label, body]) => (
                <li key={label} className="flex gap-3">
                  <Stencil tone="grease" className="mt-1 w-24 shrink-0">
                    {label}
                  </Stencil>
                  <GreaseNote tone="dim" className="text-sm">
                    {body}
                  </GreaseNote>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <RailLine />
        <p className="mt-4 text-xs text-muted-foreground">
          Values from FantasyCalc&rsquo;s redraft market, which prices the top ~192
          QB, RB, WR and TE. Kickers and defenses are streamed, not traded, so
          they are not on the board. Not affiliated with Yahoo or the NFL.
        </p>
      </footer>
    </div>
  );
}

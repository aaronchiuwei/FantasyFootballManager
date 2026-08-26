import Link from "next/link";
import type { Metadata } from "next";
import { AlertCircle, CheckCircle2, ArrowRightIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
import { DisconnectYahooButton } from "@/components/leagues/disconnect-yahoo-button";
import { ImportLeagueButton } from "@/components/leagues/import-league-button";
import { createClient } from "@/lib/supabase/server";
import {
  getYahooConnection,
  YahooReauthRequired,
} from "@/lib/sources/yahoo-auth";
import { discoverLeagues, type DiscoveredLeague } from "@/lib/sources/yahoo";

export const metadata: Metadata = { title: "Leagues" };

/** One league on a rail: name along it, state stamped at its end. */
function LeagueRow({
  name,
  season,
  detail,
  action,
}: {
  name: string;
  season: number | string | null;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-plate text-base font-semibold text-foreground">
            {name}
          </p>
          {season ? <Badge variant="outline">{season}</Badge> : null}
        </div>
        <p
          data-numeric
          className="stencil mt-1 tabular-nums text-chalk-dim"
        >
          {detail}
        </p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [connection, { data: imported }] = await Promise.all([
    getYahooConnection(user!.id),
    supabase
      .from("leagues")
      .select("id, name, season, num_teams, yahoo_league_key, last_synced_at")
      .order("season", { ascending: false }),
  ]);

  const importedKeys = new Set(
    (imported ?? []).map((league) => league.yahoo_league_key),
  );

  let discovered: DiscoveredLeague[] = [];
  let discoveryError: string | null = null;

  if (connection.connected && !connection.needsReauth) {
    try {
      ({ leagues: discovered } = await discoverLeagues(user!.id));
    } catch (cause) {
      discoveryError =
        cause instanceof YahooReauthRequired
          ? "Your Yahoo link expired. Reconnect to keep importing."
          : cause instanceof Error
            ? cause.message
            : "Could not reach Yahoo.";
    }
  }

  const needsReauth = connection.needsReauth || discoveryError !== null;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
          Leagues
        </h1>
        <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground">
          Connect Yahoo, then import the league you want to manage.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Yahoo link failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {connected ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Yahoo connected</AlertTitle>
          <AlertDescription>Pick a league below to import it.</AlertDescription>
        </Alert>
      ) : null}

      <Panel
        label="Yahoo account"
        note={
          connection.connected
            ? needsReauth
              ? "The link needs renewing before leagues can be read."
              : "Linked. Tokens are stored encrypted, server-side only."
            : "Read-only access to your fantasy leagues."
        }
        action={
          connection.connected && !needsReauth ? (
            <DisconnectYahooButton />
          ) : (
            <Button asChild size="sm">
              <a href="/api/yahoo/authorize">
                {connection.connected ? "Reconnect Yahoo" : "Connect Yahoo"}
              </a>
            </Button>
          )
        }
      >
        {discoveryError ? (
          <p className="text-sm text-destructive">{discoveryError}</p>
        ) : null}
      </Panel>

      {discovered.length > 0 ? (
        <Panel label={`On your Yahoo account · ${discovered.length}`}>
          <ul className="flex flex-col">
            {discovered.map((league, i) => (
              <li key={league.leagueKey}>
                <LeagueRow
                  name={league.name}
                  season={league.season}
                  detail={`${league.numTeams ?? "?"} teams${
                    league.scoringType ? ` · ${league.scoringType}` : ""
                  }`}
                  action={
                    <ImportLeagueButton
                      leagueKey={league.leagueKey}
                      label={
                        importedKeys.has(league.leagueKey)
                          ? "Re-import"
                          : "Import"
                      }
                      variant={
                        importedKeys.has(league.leagueKey)
                          ? "outline"
                          : "default"
                      }
                    />
                  }
                />
                {i < discovered.length - 1 ? <RailLine /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel label="Imported">
        {imported && imported.length > 0 ? (
          <ul className="flex flex-col">
            {imported.map((league, i) => (
              <li key={league.id}>
                <LeagueRow
                  name={league.name}
                  season={league.season}
                  detail={`${league.num_teams ?? "?"} teams${
                    league.last_synced_at
                      ? ` · synced ${new Date(
                          league.last_synced_at,
                        ).toLocaleDateString()}`
                      : ""
                  }`}
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/leagues/${league.id}`}>
                        Open
                        <ArrowRightIcon aria-hidden />
                      </Link>
                    </Button>
                  }
                />
                {i < imported.length - 1 ? <RailLine /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] px-4 py-8 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_65%,transparent)]">
            <Stencil tone="grease">No boards yet</Stencil>
            <p className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
              Once a league is imported it appears here, and every other screen
              in this app builds itself from it.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

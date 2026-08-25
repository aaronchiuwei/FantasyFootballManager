import Link from "next/link";
import type { Metadata } from "next";
import { AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DisconnectYahooButton } from "@/components/leagues/disconnect-yahoo-button";
import { ImportLeagueButton } from "@/components/leagues/import-league-button";
import { createClient } from "@/lib/supabase/server";
import {
  getYahooConnection,
  YahooReauthRequired,
} from "@/lib/sources/yahoo-auth";
import { discoverLeagues, type DiscoveredLeague } from "@/lib/sources/yahoo";

export const metadata: Metadata = { title: "Leagues" };

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
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Leagues</h1>
        <p className="text-muted-foreground">
          Connect Yahoo, then import the league you want to manage.
        </p>
      </div>

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
          <AlertDescription>
            Pick a league below to import it.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Yahoo account</CardTitle>
          <CardDescription>
            {connection.connected
              ? needsReauth
                ? "The link needs renewing before leagues can be read."
                : "Linked. Tokens are stored encrypted, server-side only."
              : "Read-only access to your fantasy leagues."}
          </CardDescription>
          <CardAction>
            {connection.connected && !needsReauth ? (
              <DisconnectYahooButton />
            ) : (
              <Button asChild size="sm">
                <a href="/api/yahoo/authorize">
                  {connection.connected ? "Reconnect Yahoo" : "Connect Yahoo"}
                </a>
              </Button>
            )}
          </CardAction>
        </CardHeader>

        {discoveryError ? (
          <CardContent className="text-sm text-destructive">
            {discoveryError}
          </CardContent>
        ) : null}
      </Card>

      {discovered.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            On your Yahoo account
          </h2>

          <div className="space-y-2">
            {discovered.map((league) => (
              <Card key={league.leagueKey}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{league.name}</p>
                      <Badge variant="outline">{league.season}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {league.numTeams ?? "?"} teams
                      {league.scoringType ? ` · ${league.scoringType}` : ""}
                    </p>
                  </div>

                  <ImportLeagueButton
                    leagueKey={league.leagueKey}
                    label={
                      importedKeys.has(league.leagueKey) ? "Re-import" : "Import"
                    }
                    variant={
                      importedKeys.has(league.leagueKey) ? "outline" : "default"
                    }
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Imported</h2>

        {imported && imported.length > 0 ? (
          <div className="space-y-2">
            {imported.map((league) => (
              <Card key={league.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{league.name}</p>
                      <Badge variant="outline">{league.season}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {league.num_teams ?? "?"} teams
                      {league.last_synced_at
                        ? ` · synced ${new Date(league.last_synced_at).toLocaleString()}`
                        : ""}
                    </p>
                  </div>

                  <Button asChild size="sm" variant="outline">
                    <Link href={`/leagues/${league.id}`}>
                      Open
                      <ExternalLink className="size-4" aria-hidden />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing imported yet.
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}

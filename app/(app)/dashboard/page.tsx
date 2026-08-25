import Link from "next/link";
import type { Metadata } from "next";

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
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: userData }, { data: leagues }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("leagues")
      .select("id, name, season, num_teams, is_dynasty")
      .order("season", { ascending: false }),
  ]);

  const user = userData.user!;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Signed in as {user.email}.</p>
      </div>

      {leagues && leagues.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Your leagues
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {leagues.map((league) => (
              <Card key={league.id}>
                <CardHeader>
                  <CardTitle className="truncate">{league.name}</CardTitle>
                  <CardDescription>
                    {league.season} · {league.num_teams ?? "?"} teams
                  </CardDescription>
                  <CardAction>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/leagues/${league.id}`}>Open</Link>
                    </Button>
                  </CardAction>
                </CardHeader>
                {league.is_dynasty ? (
                  <CardContent>
                    <Badge variant="secondary">Keeper league</Badge>
                  </CardContent>
                ) : null}
              </Card>
            ))}
          </div>
        </section>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Link your Yahoo league</CardTitle>
            <CardDescription>
              Connect a Yahoo account and import a league to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/leagues">Connect Yahoo</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

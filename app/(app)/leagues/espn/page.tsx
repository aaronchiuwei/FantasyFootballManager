import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeftIcon, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EspnLeagueForm } from "@/components/leagues/espn-league-form";
import { latestEspnSeason } from "@/lib/leagues/espn-input";
import { getEspnConnection } from "@/lib/sources/espn-auth";
import { createClient } from "@/lib/supabase/server";

import { connectEspnLeagueAction } from "./actions";

export const metadata: Metadata = { title: "Connect an ESPN league" };

export default async function NewEspnLeaguePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=%2Fleagues%2Fespn");

  const connection = await getEspnConnection(user.id);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            Connect an ESPN league
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground">
            ESPN has no app to authorize, so a league is named rather than
            picked: paste its id and the season. Everything after that is the
            same board a Yahoo league gets.
          </p>
        </div>

        <Button asChild size="sm" variant="ghost">
          <Link href="/leagues">
            <ArrowLeftIcon aria-hidden />
            All leagues
          </Link>
        </Button>
      </header>

      <Alert>
        <Info />
        <AlertTitle>Public leagues need nothing else</AlertTitle>
        <AlertDescription>
          ESPN answers a public league to anyone who asks. A private one wants
          the two cookies your browser holds, and there is a box for those
          below. Either way the first sync pulls the rosters, prices every
          player and fills in the rest of the board.
        </AlertDescription>
      </Alert>

      <EspnLeagueForm
        action={connectEspnLeagueAction}
        defaultSeason={latestEspnSeason()}
        hasStoredCookies={connection.connected}
      />
    </div>
  );
}

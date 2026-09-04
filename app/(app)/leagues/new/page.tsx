import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeftIcon, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  BLANK_MANUAL_LEAGUE,
  ManualLeagueForm,
} from "@/components/leagues/manual-league-form";

import { createManualLeagueAction } from "./actions";

export const metadata: Metadata = { title: "New league" };

export default function NewLeaguePage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
            Set up a league by hand
          </h1>
          <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground">
            Every screen in this app is built from the league settings and the
            rosters. Type them in here and the rest works exactly as it does for
            an imported league.
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
        <AlertTitle>Two steps</AlertTitle>
        <AlertDescription>
          Settings and team names here, then fill in the rosters. The player
          list, the trade market and the projections are fetched for you, and
          the board reprices itself whenever you change it — there is nothing to
          press.
        </AlertDescription>
      </Alert>

      <ManualLeagueForm
        action={createManualLeagueAction}
        defaults={BLANK_MANUAL_LEAGUE}
        submitLabel="Create league"
        pendingLabel="Creating"
        withTeams
      />
    </div>
  );
}

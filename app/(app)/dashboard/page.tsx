import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, Stencil } from "@/components/board/panel";
import { RailLine } from "@/components/board/rail";
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
  const hasLeagues = Boolean(leagues && leagues.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-plate text-3xl leading-tight font-bold tracking-[-0.01em] text-foreground">
          Your boards
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Signed in as {user.email}.
        </p>
      </header>

      {hasLeagues ? (
        <Panel
          label={`Leagues · ${leagues!.length}`}
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/leagues">Import</Link>
            </Button>
          }
        >
          {/* A rail per league, not a card per league. The name reads along
              the rail and the controls sit at its end, which is how a board
              lists the rooms it opens onto. */}
          <ul className="stagger-seat flex flex-col">
            {leagues!.map((league, i) => (
              <li
                key={league.id}
                style={{ "--seat-index": i } as React.CSSProperties}
              >
                <Link
                  href={`/leagues/${league.id}`}
                  className="group/row flex flex-wrap items-center gap-x-4 gap-y-1 py-3 transition-colors duration-(--motion-fast) ease-(--ease-out) hover:bg-[color-mix(in_oklch,var(--channel)_35%,transparent)]"
                >
                  <span className="min-w-0 flex-1 truncate font-plate text-base font-semibold text-foreground">
                    {league.name}
                  </span>

                  <span
                    data-numeric
                    className="stencil shrink-0 tabular-nums text-chalk-dim"
                  >
                    {league.season} · {league.num_teams ?? "?"} teams
                  </span>

                  {league.is_dynasty ? (
                    <Badge variant="outline">Keeper</Badge>
                  ) : null}

                  <ArrowRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-chalk-dim transition-transform duration-(--motion-fast) ease-(--ease-out) group-hover/row:translate-x-0.5 group-hover/row:text-grease"
                  />
                </Link>
                {i < leagues!.length - 1 ? <RailLine /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        /* The empty board: the gap is shown, and it says how to fill it. */
        <Panel label="Leagues" inset>
          <div className="flex flex-col items-start gap-4 py-6">
            <Stencil tone="grease">Board empty</Stencil>
            <p className="max-w-[52ch] text-sm leading-relaxed text-muted-foreground">
              Connect a Yahoo account and import a league. Everything else on
              this board builds itself from that one step.
            </p>
            <Button asChild>
              <Link href="/leagues">Connect Yahoo</Link>
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

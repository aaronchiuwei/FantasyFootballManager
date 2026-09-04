import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Plate, PlateBody, PlateCore, PlateName, PlateMeta, PlateValue } from "@/components/board/plate";
import { Rail, RailLine } from "@/components/board/rail";
import { Stencil, GreaseNote } from "@/components/board/panel";
import { ExampleBoard } from "@/components/marketing/example-board";
import { SiteHeader } from "@/components/board/site-header";
import { createClient } from "@/lib/supabase/server";

/**
 * Persuade, inside the board's world. The visitor gets one claim, one working
 * fragment of the real interface, and the product's actual limits in writing,
 * which is the one thing on this page a competitor cannot copy without also
 * having to be honest.
 */

const CAPABILITIES = [
  {
    label: "Leagues",
    title: "Yahoo, ESPN, or typed in by hand",
    body: "Connect Yahoo and pick a league, or point at an ESPN league by id — public ones need no login at all. No API access? Enter the settings, teams and rosters yourself; every screen is built the same way from any of the three.",
  },
  {
    label: "Values",
    title: "Every roster priced from the market",
    body: "Sleeper, FantasyCalc and DynastyProcess are reconciled through a player-identity crosswalk, so one player is one player across all three.",
  },
  {
    label: "Trades",
    title: "The math, and then a sentence",
    body: "Bonus math for roster fit, a fairness band, and a verdict you could say out loud to the manager on the other side.",
  },
  {
    label: "Needs",
    title: "What each roster is actually short of",
    body: "A needs vector per team turns trade search from who is worth the most into who wins by trading with whom.",
  },
  {
    label: "Search",
    title: "Trades nobody finds by hand",
    body: "Win-win search across the whole league, a package builder around one player, and three-team cycles with a verdict on every leg.",
  },
];

const LIMITS = [
  "No NFL schedule source, so no bye weeks and no playoff schedule.",
  "No trade deadline is read from any league. Check your own settings.",
  "Three-team cycle search is a bounded beam, not an exhaustive one.",
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader signedIn={Boolean(user)} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {/* HERO. Split, not centred: the claim on the left, the working board
            on the right, so the mechanism is visible in the first viewport
            rather than described. */}
        <section className="grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:py-16">
          <div className="animate-seat">
            <h1 className="max-w-[15ch] text-balance font-plate text-4xl leading-[1.05] font-bold tracking-[-0.015em] text-foreground sm:text-5xl lg:text-6xl">
              Know who wins the trade before you accept it.
            </h1>
            <p className="mt-5 max-w-[46ch] text-pretty text-base leading-relaxed text-muted-foreground">
              Every player on every roster carries a market value with its
              source attached.
            </p>

            {/* The analyzer leads, even for a signed-in manager. It is the
                thing the visitor came to do, it needs no account and no
                import, and a landing page whose first button is a signup form
                is asking for a commitment before it has given anything. */}
            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Button asChild size="lg">
                <Link href="/trade">Analyze a trade</Link>
              </Button>
              {user ? (
                <Button asChild size="lg" variant="outline">
                  <Link href="/dashboard">Open your board</Link>
                </Button>
              ) : (
                <Button asChild size="lg" variant="outline">
                  <Link href="/signup">Add your league</Link>
                </Button>
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              No account needed to price two packages against the market.
            </p>
          </div>

          <div
            className="animate-seat rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_38%,transparent)] p-4 shadow-[inset_0_1px_3px_color-mix(in_oklch,var(--board-deep)_60%,transparent)] sm:p-5"
            style={{ animationDelay: "90ms" }}
          >
            <ExampleBoard />
          </div>
        </section>

        <RailLine />

        {/* PROVENANCE. One full-width rail, three plates, three states. The
            product's actual position, shown rather than claimed. */}
        <section className="py-14 sm:py-20">
          <h2 className="max-w-[22ch] text-balance font-plate text-2xl leading-tight font-bold tracking-[-0.01em] text-foreground sm:text-3xl">
            A number carries where it came from.
          </h2>
          <p className="mt-4 max-w-[62ch] text-pretty leading-relaxed text-muted-foreground">
            Three plates, three different kinds of certainty. A modelled value
            is marked as modelled and an unpriced player is marked as unpriced,
            because a tool that launders all three into one confident figure is
            worse than no tool.
          </p>

          <div className="mt-8 grid gap-2.5 sm:grid-cols-3">
            {[
              {
                position: "WR",
                name: "T. Lindqvist",
                meta: "Market · FantasyCalc",
                value: "5,310",
                color: "var(--source-market-plate)",
                note: "Priced by a live market.",
              },
              {
                position: "TE",
                name: "R. Battaglia",
                meta: "Modelled · fallback",
                value: "1,290",
                color: "var(--source-model-plate)",
                note: "No market price. Estimated, and labelled.",
              },
              {
                position: "K",
                name: "A. Ferreira",
                meta: "Unvalued",
                value: "--",
                color: "var(--source-unvalued-plate)",
                note: "Nobody prices this. So neither do we.",
              },
            ].map((p) => (
              <div key={p.name} className="flex flex-col gap-2">
                <Plate className="h-12">
                  <PlateCore position={p.position} />
                  <PlateBody>
                    <PlateName>{p.name}</PlateName>
                    <PlateMeta style={{ color: p.color }}>{p.meta}</PlateMeta>
                  </PlateBody>
                  <div className="flex items-center pr-2.5">
                    <PlateValue>{p.value}</PlateValue>
                  </div>
                </Plate>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {p.note}
                </p>
              </div>
            ))}
          </div>
        </section>

        <RailLine />

        {/* CAPABILITIES. A stack of rails, each naming itself on its end cap.
            Not three equal cards. */}
        <section className="py-14 sm:py-20">
          <h2 className="max-w-[20ch] text-balance font-plate text-2xl leading-tight font-bold tracking-[-0.01em] text-foreground sm:text-3xl">
            What is on the board.
          </h2>

          <div className="mt-8 flex flex-col gap-3">
            {CAPABILITIES.map((c) => (
              <div key={c.label} className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-6">
                <Rail label={c.label} className="self-start" />
                <div className="pb-3">
                  <h3 className="font-plate text-lg leading-snug font-semibold text-foreground">
                    {c.title}
                  </h3>
                  <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
                    {c.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <RailLine />

        {/* LIMITS. Written on the board in grease pencil. */}
        <section className="py-14 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <h2 className="max-w-[18ch] text-balance font-plate text-2xl leading-tight font-bold tracking-[-0.01em] text-foreground sm:text-3xl">
              And what is not on it.
            </h2>

            <ul className="flex flex-col gap-4">
              {LIMITS.map((limit) => (
                <li key={limit} className="flex gap-3">
                  <Stencil tone="grease" className="mt-1 shrink-0">
                    No
                  </Stencil>
                  <GreaseNote tone="dim" className="text-base">
                    {limit}
                  </GreaseNote>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <RailLine />

        <section className="flex flex-col items-start gap-6 py-16 sm:py-24">
          <h2 className="max-w-[16ch] text-balance font-plate text-3xl leading-[1.05] font-bold tracking-[-0.015em] text-foreground sm:text-4xl">
            Bring a league. Your board builds itself.
          </h2>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button asChild size="lg">
              <Link href={user ? "/dashboard" : "/signup"}>
                {user ? "Open your board" : "Get started"}
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/trade">Or just analyze a trade</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <RailLine />
        <p className="mt-4 text-xs text-muted-foreground">
          A companion for redraft leagues — Yahoo, ESPN, or kept by hand. Not
          affiliated with Yahoo, ESPN or the NFL.
        </p>
      </footer>
    </div>
  );
}

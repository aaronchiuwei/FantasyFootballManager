"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import {
  activeSection,
  LEAGUE_SECTIONS,
  sectionHref,
} from "@/lib/leagues/nav";
import { cn } from "@/lib/utils";

/**
 * One league's seven screens, as a channel rail across the top of the board.
 *
 * Until this phase every one of them carried its own back button to the league
 * page and nothing else, so moving between two of them (the waiver wire and
 * the overview that says what a team is thin at, say) cost three navigations,
 * one of them through a page nobody wanted. The screens all existed; what did
 * not was any way to get between them.
 *
 * It scrolls horizontally rather than wrapping. Seven tabs do not fit on a
 * phone, and a nav bar that reflows to three lines pushes the page's own
 * heading below the fold, which is the thing the user came for. A rail that
 * runs off the edge reads as "there is more this way" at a glance.
 *
 * The current section is marked in grease pencil under its label rather than
 * filled behind it: a filled tab would be a second container in a world that
 * has decided not to have any.
 *
 * A client component, which is what `usePathname` costs. It is small on
 * purpose: the league name and the ids come from the server layout above it,
 * so nothing here fetches and nothing here holds state.
 */
export function LeagueNav({
  leagueId,
  leagueName,
}: {
  leagueId: string;
  leagueName: string;
}) {
  const pathname = usePathname();
  const active = activeSection(pathname, leagueId);

  return (
    <div className="flex flex-col gap-3">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link
          href="/leagues"
          className="stencil shrink-0 underline-offset-4 hover:text-foreground hover:underline"
        >
          All leagues
        </Link>
        <ChevronRight className="size-3 shrink-0" aria-hidden />
        <span className="stencil truncate text-foreground">{leagueName}</span>
      </nav>

      {/* `-mx-4 px-4` so the rail's scroll region reaches the screen edge on a
          phone while the tabs still line up with the content above them. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
        <div className="rail flex w-max min-w-full items-stretch rounded-xs">
          {LEAGUE_SECTIONS.map((section) => {
            const current = active === section.key;

            return (
              <Link
                key={section.key}
                href={sectionHref(leagueId, section)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "stencil relative inline-flex shrink-0 items-center px-3.5 py-2.5 whitespace-nowrap",
                  "transition-colors duration-(--motion-fast) ease-(--ease-out) motion-reduce:transition-none",
                  "after:absolute after:inset-x-2.5 after:bottom-1 after:h-0.5 after:content-['']",
                  "after:origin-left after:bg-grease after:transition-transform",
                  "after:duration-(--motion-base) after:ease-(--ease-out)",
                  current
                    ? "text-foreground after:scale-x-100"
                    : "text-chalk-dim after:scale-x-0 hover:text-foreground",
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

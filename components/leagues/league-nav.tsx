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
 * One league's seven screens, as a strip.
 *
 * Until this phase every one of them carried its own back button to the league
 * page and nothing else, so moving between two of them — the waiver wire and
 * the overview that says what a team is thin at, say — cost three navigations,
 * one of them through a page nobody wanted. The screens all existed; what did
 * not was any way to get between them.
 *
 * It scrolls horizontally rather than wrapping. Seven pills do not fit on a
 * phone, and a nav bar that reflows to three lines pushes the page's own
 * heading below the fold — which is the thing the user came for. A strip that
 * runs off the edge is legible as "there is more this way" at a glance, and
 * the active pill is scrolled into view by the browser on load because it is
 * the focused link's own container.
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
    <div className="space-y-3">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground"
      >
        <Link
          href="/leagues"
          className="shrink-0 underline-offset-4 hover:text-foreground hover:underline"
        >
          All leagues
        </Link>
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate text-foreground">{leagueName}</span>
      </nav>

      {/* `-mx-4 px-4` so the strip's scroll region reaches the screen edge on a
          phone while the pills still line up with the content above them. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6">
        <div className="flex w-max items-center gap-1.5">
          {LEAGUE_SECTIONS.map((section) => {
            const current = active === section.key;

            return (
              <Link
                key={section.key}
                href={sectionHref(leagueId, section)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center rounded-4xl border px-3 text-xs font-medium transition-colors motion-reduce:transition-none",
                  current
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
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

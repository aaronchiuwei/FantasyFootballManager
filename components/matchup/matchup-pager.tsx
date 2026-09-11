import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Stencil } from "@/components/board/panel";
import { cn } from "@/lib/utils";

/**
 * Step through the week's matchups without leaving the one on screen.
 *
 * The board below is a list and this is a viewer over the same list, which is
 * the pairing a manager actually wants: the summary answers "who else is in
 * trouble" and this answers "how", and clicking into a rail and back out again
 * to compare two of them is three navigations for one question.
 *
 * Links rather than a control, so the panel stays a server render and a
 * particular matchup is a URL somebody can send. It wraps in both directions —
 * there is no first or last matchup in a week, only a ring of them, and an
 * arrow that greys out at the end of a list of six is a dead control five
 * sixths of the time.
 */

function Step({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      // The chip's own visual, written out rather than borrowed: `.chip`
      // carries a 0.75rem inline padding sized for a word, which on a square
      // the width of one glyph leaves the glyph no room at all.
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-xs",
        "text-chalk-dim shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--channel-lip)_30%,transparent)]",
        "transition-colors duration-(--motion-fast) ease-(--ease-out)",
        "hover:bg-[color-mix(in_oklch,var(--channel)_60%,transparent)] hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function MatchupPager({
  hrefPrev,
  hrefNext,
  index,
  count,
}: {
  hrefPrev: string;
  hrefNext: string;
  /** Zero-based, printed one-based. */
  index: number;
  count: number;
}) {
  if (count < 2) return null;

  return (
    <div className="flex items-center gap-1.5">
      <Step href={hrefPrev} label="Previous matchup">
        <ChevronLeft aria-hidden className="size-3.5" />
      </Step>

      <Stencil data-numeric className="w-14 text-center tabular-nums">
        {index + 1} of {count}
      </Stencil>

      <Step href={hrefNext} label="Next matchup">
        <ChevronRight aria-hidden className="size-3.5" />
      </Step>
    </div>
  );
}

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BoardNav } from "@/components/board/board-nav";
import { ThemeToggle } from "@/components/board/theme-toggle";
import { signOut } from "@/app/(auth)/actions";

/**
 * The head of the board: the wall's own title stencilled on it, the sections
 * ruled across, and the fixture switch at the far end. The channel hairline
 * underneath is the rail this whole header sits in.
 *
 * Every signed-in screen wears this, which is why it is a component rather
 * than markup in `app/(app)/layout.tsx`. The open trade analyzer lives outside
 * that route group -- it has to render for a stranger too -- but a manager who
 * reaches it from the Analyzer section should not watch the board's sections
 * disappear underneath them.
 */

const SECTIONS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/leagues", label: "Leagues" },
  { href: "/trade", label: "Analyzer" },
  { href: "/account", label: "Account" },
];

export function AppHeader({ email }: { email?: string | null }) {
  return (
    <header
      className={[
        "sticky top-0 z-30",
        "bg-[color-mix(in_oklch,var(--board-deep)_88%,transparent)] backdrop-blur-sm",
        "shadow-[inset_0_-1px_0_color-mix(in_oklch,var(--board-deep)_70%,transparent),0_1px_0_color-mix(in_oklch,var(--channel-lip)_30%,transparent)]",
      ].join(" ")}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-x-5 px-4 sm:px-6">
        <Link
          href="/dashboard"
          className="group/mark flex min-w-0 shrink-0 items-center gap-2.5 py-2.5"
        >
          <span aria-hidden className="h-6 w-1 shrink-0 rounded-xs bg-grease" />
          <span className="flex min-w-0 flex-col leading-none">
            <span className="stencil text-[0.5625rem] text-chalk-dim">
              Fantasy Football
            </span>
            <span className="stencil mt-0.5 text-[0.8125rem] text-foreground">
              Manager
            </span>
          </span>
        </Link>

        {/* On a phone the sections drop to their own rail rather than
            squeezing the wall title or the sign-out control. */}
        <BoardNav className="ml-auto hidden sm:flex" items={SECTIONS} />

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:ml-0">
          {/* The address is the account, so it is the way into it. */}
          {email ? (
            <Link
              href="/account"
              className="hidden max-w-[15rem] truncate text-xs text-muted-foreground underline-offset-4 transition-colors duration-(--motion-fast) ease-(--ease-out) hover:text-foreground hover:underline hover:decoration-grease hover:decoration-2 lg:inline"
            >
              {email}
            </Link>
          ) : null}
          <ThemeToggle />
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-2 sm:hidden">
        <BoardNav items={SECTIONS} />
      </div>
    </header>
  );
}

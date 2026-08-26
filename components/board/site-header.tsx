import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/board/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * The head of a page nobody has signed in to see.
 *
 * The app's own header (`app/(app)/layout.tsx`) carries the sections and the
 * sign-out control, because behind the gate there is somewhere to go. Out here
 * there are two facts: what this is, and whether you have an account. Shared
 * between the landing page and the open trade analyzer so the wall title is
 * stencilled the same way on both.
 */
export function SiteHeader({
  signedIn,
  className,
}: {
  signedIn: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-4 sm:px-6",
        className,
      )}
    >
      <Link href="/" className="flex min-w-0 items-center gap-2.5">
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

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        {signedIn ? (
          <Button asChild size="sm">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
        ) : (
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        )}
      </div>
    </header>
  );
}

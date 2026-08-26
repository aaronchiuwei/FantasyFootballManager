"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * The outermost boundary: the landing page, the auth screens, and anything
 * that throws in the signed-in shell's *layout* rather than below it, which
 * is where `getUser()` runs, so a Supabase outage lands here rather than in
 * the boundary inside the shell.
 *
 * **Written in plain elements on purpose.** A root `error.tsx` is a client
 * component wrapped around every route in the app, so whatever it imports
 * lands in the first load of the landing page and the sign-in screen, the two
 * pages that currently ship no application JavaScript at all. Importing the
 * button and card components cost 16 kB there for a page nobody should ever
 * see. The classes are the same tokens those components use, so it looks the
 * same and costs nothing.
 *
 * It also offers no link into the app. If the shell's own layout could not
 * render, "go to the dashboard" is a suggestion that fails the same way, and
 * sending the user round that loop is worse than admitting the trip.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-xs bg-[color-mix(in_oklch,var(--board-deep)_45%,transparent)] p-6 text-foreground shadow-[inset_0_1px_0_color-mix(in_oklch,var(--channel-lip)_26%,transparent)]">
        <div className="space-y-1.5">
          <h1 className="font-plate text-lg font-bold tracking-[-0.01em]">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground">
            The app could not load. If it keeps happening, it is on our side
            rather than yours.
          </p>
        </div>

        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 w-full items-center justify-center rounded-xs bg-primary px-4 font-plate text-xs font-semibold uppercase tracking-[0.09em] text-primary-foreground transition-colors duration-(--motion-fast) hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
        >
          Try again
        </button>

        <Link
          href="/"
          className="inline-flex h-9 w-full items-center justify-center rounded-xs px-4 font-plate text-xs font-semibold uppercase tracking-[0.09em] text-muted-foreground transition-colors duration-(--motion-fast) hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
        >
          Back to the start
        </Link>

        {error.digest ? (
          <p className="stencil text-center text-chalk-dim">
            Reference {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}

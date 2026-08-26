"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The signed-in shell's error boundary.
 *
 * Every screen in here reads from Supabase, three of them reach Yahoo through
 * it, and until this phase a thrown read produced Next's own unstyled error
 * page — which loses the header, the league nav and any way back that is not
 * the browser's own button.
 *
 * `reset()` is the point. Almost everything that throws on these pages is
 * transient: a Supabase connection that dropped, a Yahoo call that timed out,
 * a token refreshed in another tab. Re-rendering the segment is the correct
 * first response and it costs one click, so it is the primary action rather
 * than advice in a sentence.
 *
 * The digest is shown because Next replaces a server error's message with a
 * generic one in production — deliberately, so a stack trace never reaches the
 * browser — and the digest is then the only thing tying what the user saw to
 * what the server logged.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server already logged it; this is for the browser console, where
    // anyone debugging a client-side throw will actually look.
    console.error(error);
  }, [error]);

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Something went wrong on this page</CardTitle>
        <CardDescription>
          The rest of the app is fine. This screen failed to load. It is
          usually a dropped connection rather than anything you did.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={reset}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Dashboard</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/leagues">All leagues</Link>
          </Button>
        </div>

        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">
            Reference {error.digest}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

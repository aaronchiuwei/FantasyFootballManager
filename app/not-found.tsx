import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Not found" };

/**
 * The app's own 404, rather than Next's black-on-white default.
 *
 * It offers the dashboard and nothing more specific, because the thing that
 * was not found is by definition unknown here. A league that does not exist,
 * the case with an actual answer, has its own boundary next to the league
 * routes.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Nothing here</CardTitle>
          <CardDescription>
            That page does not exist, or it belongs to someone else&rsquo;s
            account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button asChild className="w-full">
            <Link href="/dashboard">Go to the dashboard</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/">Back to the start</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

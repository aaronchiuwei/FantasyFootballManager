import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Reached by every `notFound()` under a league: an id that does not exist, one
 * that belongs to another user, a player id with no row.
 *
 * It sits above `[id]` rather than inside it so that it renders in the app
 * shell whether the *page* or the league *layout* was the thing that could not
 * find anything — a boundary that needs the segment it is reporting on to have
 * rendered successfully is a boundary that does not work in the one case it
 * exists for.
 *
 * The "missing" and "not yours" cases are not distinguished, on purpose. RLS
 * makes another user's league indistinguishable from a deleted one at the read
 * — the row simply is not there — and that is the right thing for the UI to
 * say too: confirming to a stranger that a league exists is telling them
 * something.
 */
export default function LeagueNotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Not found in your leagues</CardTitle>
        <CardDescription>
          Whatever this link points at is not on your account. It could be a league that
          was removed, a player who is not priced here, or somebody else&rsquo;s
          URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/leagues">All leagues</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

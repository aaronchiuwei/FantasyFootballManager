import { notFound } from "next/navigation";

import { LeagueNav } from "@/components/leagues/league-nav";
import { createClient } from "@/lib/supabase/server";

/**
 * The chrome every one of this league's screens shares: where you are, and the
 * six other places you could be.
 *
 * Reading the league here rather than passing it down is deliberate. The
 * layout renders once per league and stays mounted across navigations between
 * its children, so the strip does not flicker while a page loads — and the
 * sibling `loading.tsx` renders *inside* this layout, which is what makes a
 * click on a tab feel immediate rather than dead.
 *
 * It is also the gate: a league id that is not this user's fails RLS and comes
 * back empty here, so every child gets a 404 rather than a page assembled from
 * seven empty queries. Each child still calls `notFound()` for itself — a
 * layout is a convenience, and §2's rule about middleware applies just as much
 * to one of these.
 */
export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (!league) notFound();

  return (
    <div className="space-y-6">
      <LeagueNav leagueId={league.id} leagueName={league.name} />
      {children}
    </div>
  );
}

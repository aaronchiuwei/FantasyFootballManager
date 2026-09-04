import { after } from "next/server";
import { notFound } from "next/navigation";

import { LeagueNav } from "@/components/leagues/league-nav";
import { ensureManualLeagueSynced } from "@/lib/sync/auto";
import { kickStage } from "@/lib/sync/pipeline";
import { createClient } from "@/lib/supabase/server";

/**
 * The chrome every one of this league's screens shares: where you are, and the
 * other places you could be — which is not the same list for a league synced
 * from Yahoo as for one kept by hand, so `source` is read here alongside the
 * name.
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

  // Both reads are RLS-scoped, so the switcher can only ever offer boards this
  // user owns — the list is the authorization, not a filter over a wider one.
  const [{ data: league }, { data: leagues }] = await Promise.all([
    supabase
      .from("leagues")
      .select("id, name, source, last_synced_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("leagues")
      .select("id, name, season, source")
      .order("season", { ascending: false })
      .order("name"),
  ]);

  if (!league) notFound();

  // A manual league has no sync button, so something has to notice its edits.
  // This is the one place every one of its screens passes through, and the
  // check is a single indexed read when there is nothing to do. The run row is
  // opened here where the session is live; only the kick waits for `after`.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const pending = await ensureManualLeagueSynced(supabase, user.id, league);
    if (pending) after(() => kickStage(pending.runId, pending.stageId));
  }

  return (
    <div className="space-y-6">
      <LeagueNav
        leagueId={league.id}
        leagueName={league.name}
        source={league.source}
        leagues={leagues ?? []}
      />
      {children}
    </div>
  );
}

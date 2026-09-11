import "server-only";

import { saveMatchups } from "@/lib/leagues/import";
import { isEspnLeague, refOf } from "@/lib/leagues/espn";
import { isManualLeague } from "@/lib/leagues/manual";
import { loadSleeperIds } from "@/lib/players/master";
import { loadCoverage, syncStatLines } from "@/lib/players/stats";
import { fetchEspnMatchups } from "@/lib/sources/espn";
import { fetchMatchups } from "@/lib/sources/yahoo";
import type { Db } from "@/lib/supabase/db";

/**
 * The narrow refresh a live Sunday actually needs.
 *
 * A full sync is nine stages: the player master, twenty-four FantasyCalc
 * boards, a season of projections, the value engine, the needs vectors and two
 * suggestion searches. None of that moves while a game is being played. Two
 * things do, and only two: the stat lines of the men on the field, and the
 * running total the league is keeping. So this pulls those and nothing else —
 * one Sleeper request and one scoreboard request, against a sync's several
 * dozen — which is what makes it cheap enough to run on a timer.
 *
 * It is deliberately *not* a sync run. There is no `sync_runs` row, no stage
 * chain and no progress to subscribe to, because all of that exists to make a
 * minutes-long job legible and this is a job that either lands in a second or
 * is not worth reporting. A failure here is a number that stays where it was.
 *
 * Two clients, at two privileges, and the split is load-bearing. `player_stats`
 * and `stat_coverage` are global tables every league reads and no user owns —
 * their policies grant `select` and nothing else — so the stat pull needs the
 * service role exactly as sync stage 5 does. Everything else runs on the
 * caller's own client, which is what makes the league read an authorization
 * check rather than a branch: a league this user does not own returns no row,
 * and the refresh stops there before either client is asked to write anything.
 */

/**
 * How stale a source has to be before it is worth asking again.
 *
 * Sleeper's live stats move on roughly a minute's cadence and a provider's
 * running total no faster, so asking more often than this buys nothing and
 * spends somebody else's rate limit to buy it. The client polls on its own
 * clock; this is the floor that makes a hammered tab harmless.
 */
const COOLDOWN_MS = 45_000;

export type LiveRefresh = {
  /** Whether anything was actually pulled, as opposed to still being fresh. */
  pulled: boolean;
  statLines: number;
  matchups: number;
  /** Set when the schedule half failed. The stats half is reported separately. */
  warning: string | null;
};

function stale(at: string | null | undefined, now: number): boolean {
  if (!at) return true;
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) || now - parsed >= COOLDOWN_MS;
}

/** When this league's week was last written, so a fresh one is not re-pulled. */
async function scheduleWrittenAt(
  db: Db,
  leagueId: string,
  week: number,
): Promise<string | null> {
  const { data } = await db
    .from("matchups")
    .select("updated_at")
    .eq("league_id", leagueId)
    .eq("week", week)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.updated_at ?? null;
}

/**
 * Re-pulls one week's scores for one league.
 *
 * The week has to be the league's own live week. Anything behind it is
 * finished and anything ahead of it has not been played, so refreshing either
 * would be spending a request to rewrite what is already there — and a caller
 * free to name any week is a caller free to turn a page timer into a loop over
 * the whole season.
 */
export async function refreshLiveWeek(
  db: Db,
  admin: Db,
  userId: string,
  { leagueId, week }: { leagueId: string; week: number },
): Promise<LiveRefresh> {
  const { data: league, error } = await db
    .from("leagues")
    .select("id, season, source, yahoo_league_key, current_week")
    .eq("id", leagueId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the league: ${error.message}`);
  if (!league) throw new Error("That league does not exist.");

  if (league.current_week === null || week !== league.current_week) {
    throw new Error("Only the live week can be refreshed.");
  }

  const now = Date.now();
  const manual = isManualLeague(league.source);

  const [coverage, scheduleAt] = await Promise.all([
    loadCoverage(db, [league.season]),
    manual ? Promise.resolve(null) : scheduleWrittenAt(db, leagueId, week),
  ]);

  const statsStale = stale(
    coverage.get(`${league.season}:actual:${week}`)?.fetchedAt,
    now,
  );

  let statLines = 0;
  if (statsStale) {
    // `frozenWeeks` is empty on purpose: this is the one caller that means to
    // re-pull a week it already has. Everything else skips a covered week,
    // which is right for a sync and exactly wrong here.
    const ids = await loadSleeperIds(db);
    const pulled = await syncStatLines(admin, ids, {
      season: league.season,
      kind: "actual",
      weeks: [week],
      coverage: new Map(),
    });
    statLines = pulled.rows;
  }

  let matchups = 0;
  let warning: string | null = null;

  if (!manual && stale(scheduleAt, now)) {
    // The same bargain stage 7 makes for the same reason: a schedule that
    // cannot be read costs the screen its running totals, not its stat lines.
    // Here it matters more, because this runs on a timer and a throw would be
    // an error the user sees every forty-five seconds.
    try {
      const pulled = isEspnLeague(league.source)
        ? await fetchEspnMatchups(
            userId,
            refOf({
              yahoo_league_key: league.yahoo_league_key ?? "",
              season: league.season,
            }),
            [week],
          )
        : await fetchMatchups(userId, league.yahoo_league_key ?? "", [week]);

      matchups = await saveMatchups(db, leagueId, pulled);
    } catch (cause) {
      warning =
        cause instanceof Error ? cause.message : "The scoreboard could not be read.";
    }
  }

  return {
    pulled: statsStale || matchups > 0,
    statLines,
    matchups,
    warning,
  };
}

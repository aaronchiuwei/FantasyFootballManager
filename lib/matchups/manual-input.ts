/**
 * A hand-kept league's schedule, read off a form.
 *
 * Everything else on the matchup screen comes from a provider that has already
 * decided who plays whom. A manual league has nobody to ask, and the screen's
 * honest answer to that was an empty state — which is the right answer right
 * up until the manager is willing to type it in.
 *
 * What a week needs is small: a list of pairings. Not scores. A manual league
 * already has rosters and the weekly stat grid already covers the players on
 * them, so `liveSide` sums the lines itself the moment `points_a` is null —
 * which means entering the schedule is enough to get live scoring, and asking
 * anybody to key in points on a Sunday would be asking for work the app can do.
 *
 * Pure, like every other `*-input` module here: what makes a schedule legal is
 * a claim about a form, and a claim about a form should be testable without a
 * database.
 */
import type { Planned } from "@/lib/leagues/manual-input";

/** One row of the editor. Either side may be empty; an empty row is not an error. */
export type SchedulePair = {
  a: string | null;
  b: string | null;
};

/** One matchup, as the table stores it. */
export type PlannedPairing = {
  teamA: string;
  /** Null when a team is given the week off. */
  teamB: string | null;
};

/**
 * Turn the editor's rows into the week's matchups, or say what is wrong.
 *
 * The two sides are sorted by team id rather than kept as typed, for the
 * reason the Yahoo parser sorts by team key: the primary key is
 * `(league, week, team_a)`, so one pairing has to produce one row however it
 * was entered. Nothing downstream reads left and right as home and away —
 * the screen turns the user's own team to the left regardless — so there is
 * nothing for the order to mean.
 *
 * An empty row is dropped rather than refused. A twelve-team league has six
 * rows and an eleven-team league fills five and a half of them; making the
 * manager delete the spare would be making the form's shape their problem.
 */
export function planSchedule(
  teamIds: readonly string[],
  pairs: readonly SchedulePair[],
): Planned<PlannedPairing[]> {
  const known = new Set(teamIds);
  const used = new Set<string>();
  const planned: PlannedPairing[] = [];

  for (const pair of pairs) {
    const sides = [pair.a, pair.b].filter(
      (side): side is string => side !== null && side !== "",
    );

    if (sides.length === 0) continue;

    for (const side of sides) {
      if (!known.has(side)) {
        return { ok: false, error: "That team is not in this league." };
      }
      // Catches both a team against itself and a team in two matchups, which
      // are the same mistake as far as the week is concerned: somebody is
      // playing twice and somebody else is not playing at all.
      if (used.has(side)) {
        return {
          ok: false,
          error: "A team can only play once a week. Check for a duplicate.",
        };
      }
      used.add(side);
    }

    const [first, second] = [...sides].sort();
    planned.push({ teamA: first, teamB: second ?? null });
  }

  if (planned.length === 0) {
    return {
      ok: false,
      error: "Pair up at least one matchup, or clear the week instead.",
    };
  }

  // Deterministic, so re-saving an unchanged week writes the same rows in the
  // same order and a diff of two weeks is a diff of their pairings.
  planned.sort((a, b) => a.teamA.localeCompare(b.teamA));

  return { ok: true, plan: planned };
}

/**
 * How many rows the editor offers: enough for every team to be in one, and one
 * more than that when the league is odd so the bye has somewhere to sit.
 */
export function scheduleRows(teamCount: number): number {
  return Math.ceil(Math.max(0, teamCount) / 2);
}

/**
 * A league's week, paired up: who plays whom, where each one stands, and what
 * the schedule row and the rosters say together.
 *
 * Split from the store next door for the reason every pure module here is:
 * "the user's team is on the left", "a bye is still a matchup", "a stale row
 * does not invent an opponent" are claims about behaviour, and claims about
 * behaviour should not need a database to check.
 *
 * The schedule and the rosters are two different reads of the same week and
 * this is where they meet. The row knows the pairing and the league's own
 * running total; the rosters know who is still to play, which is the thing the
 * row cannot tell you and the thing the whole screen is about.
 */
import {
  liveSide,
  matchupPhase,
  settled,
  winProbability,
  type LivePlayer,
  type LiveSide,
  type MatchupPhase,
} from "./live";

/** One row of the `matchups` table, in this app's casing. */
export type MatchupRow = {
  week: number;
  teamA: string;
  /** Null when an odd-sized league hands this team a bye. */
  teamB: string | null;
  pointsA: number | null;
  pointsB: number | null;
  projectedA: number | null;
  projectedB: number | null;
  /** The provider's own: preevent / midevent / postevent. */
  status: string | null;
  isPlayoffs: boolean;
};

/**
 * A team as the pairing needs it. Carried as a generic so the caller gets
 * whatever it put in back out — the screen wants the whole roster column, and
 * this module wants four fields of it.
 */
export type PairableTeam = {
  id: string;
  isUsersTeam: boolean;
  rank: number | null;
  /** The players currently in a starting slot. Bench points win nobody a week. */
  starters: LivePlayer[];
};

export type MatchupSide<T extends PairableTeam> = {
  team: T;
  live: LiveSide;
  /**
   * The provider's own projected final, where it publishes one. Kept beside
   * ours rather than instead of it: two projections that disagree are worth
   * seeing disagree, and ESPN publishes none at all on this view.
   */
  providerProjected: number | null;
};

export type Pairing<T extends PairableTeam> = {
  week: number;
  isPlayoffs: boolean;
  status: string | null;
  phase: MatchupPhase;
  a: MatchupSide<T>;
  /** Null on a bye — a real thing that happens, not a missing opponent. */
  b: MatchupSide<T> | null;
  /** The chance `a` outscores `b`. Null on a bye, where there is nothing to beat. */
  winProbability: number | null;
  involvesUser: boolean;
};

/**
 * Every pairing of one week, the user's first.
 *
 * Orientation is not cosmetic. The rows are stored with the two sides ordered
 * by provider team key, so that a re-sync overwrites the row it wrote last
 * time instead of mirroring it — an invariant about writes that has no
 * business reaching the screen. A manager reads his own matchup with himself
 * on the left, so the user's team is turned to side A and the probability with
 * it. Where the user is in neither side, the stored order stands.
 *
 * Ordering puts the user's own week first and then ranks the rest by the
 * better team in each, which is the order a league page already reads in.
 */
export function pairings<T extends PairableTeam>(
  rows: MatchupRow[],
  teams: T[],
  { currentWeek }: { currentWeek: number | null },
): Pairing<T>[] {
  const byId = new Map(teams.map((team) => [team.id, team]));

  const built = rows.flatMap((row): Pairing<T>[] => {
    const teamA = byId.get(row.teamA);
    // Both sides are foreign keys that cascade on delete, so an unresolvable
    // one means the team read and the schedule read disagreed. Dropping the
    // row is the only honest answer: a pairing with a side missing is not a
    // bye, and drawing it as one would report a week that is not being played.
    if (!teamA) return [];

    const teamB = row.teamB === null ? null : (byId.get(row.teamB) ?? null);
    if (row.teamB !== null && teamB === null) return [];

    const sideA: MatchupSide<T> = {
      team: teamA,
      live: liveSide(teamA.starters, row.pointsA),
      providerProjected: row.projectedA,
    };

    const sideB: MatchupSide<T> | null = teamB
      ? {
          team: teamB,
          live: liveSide(teamB.starters, row.pointsB),
          providerProjected: row.projectedB,
        }
      : null;

    // Both sides' banked points decide the phase together: a matchup whose
    // early game was the opponent's is under way, whatever this side has.
    const banked = sideA.live.banked + (sideB?.live.banked ?? 0);

    const phase = matchupPhase({
      week: row.week,
      currentWeek,
      status: row.status,
      banked,
    });

    // Settling is a property of the pairing, not of a side, which is why it
    // happens here rather than inside `liveSide`: what makes a week over is
    // the clock and the provider's own status, and neither is visible from
    // one team's list of starters.
    const [first, second] = (
      sideB && sideB.team.isUsersTeam ? [sideB, sideA] : [sideA, sideB]
    ).map((side) =>
      side && phase === "final" ? { ...side, live: settled(side.live) } : side,
    ) as [MatchupSide<T>, MatchupSide<T> | null];

    return [
      {
        week: row.week,
        isPlayoffs: row.isPlayoffs,
        status: row.status,
        phase,
        a: first,
        b: second,
        winProbability: second
          ? winProbability(first.live, second.live)
          : null,
        involvesUser: first.team.isUsersTeam || (second?.team.isUsersTeam ?? false),
      },
    ];
  });

  return built.sort(compare);
}

/** The lowest rank in a pairing, with an unranked team sorting last. */
function topRank<T extends PairableTeam>(pairing: Pairing<T>): number {
  const ranks = [pairing.a.team.rank, pairing.b?.team.rank ?? null].filter(
    (rank): rank is number => rank !== null,
  );

  return ranks.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...ranks);
}

function compare<T extends PairableTeam>(a: Pairing<T>, b: Pairing<T>): number {
  if (a.involvesUser !== b.involvesUser) return a.involvesUser ? -1 : 1;
  return topRank(a) - topRank(b);
}

/**
 * Teams this week's schedule does not mention.
 *
 * Normally empty, and worth drawing when it is not. A league whose scoreboard
 * has never been pulled for this week has every team here, which is a
 * different statement from a league that has no matchups — and a provider that
 * left one team out of a week is a data problem the screen should admit to
 * rather than quietly showing eleven teams out of twelve.
 */
export function unscheduled<T extends PairableTeam>(
  pairings: Pairing<T>[],
  teams: T[],
): T[] {
  const placed = new Set(
    pairings.flatMap((pairing) =>
      [pairing.a.team.id, pairing.b?.team.id].filter(
        (id): id is string => id !== undefined,
      ),
    ),
  );

  return teams.filter((team) => !placed.has(team.id));
}

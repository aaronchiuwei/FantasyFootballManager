/**
 * Start/sit for one week, as a pure function of a roster and a projection grid.
 *
 * Everything else in this app is denominated in *rest of season*: §5's value
 * blend, §7's needs vector, §6's roster-context delta. That is the right unit
 * for a trade, which is a claim on a whole season, and the wrong one for the
 * decision a manager actually makes most often. Sunday does not care that a
 * receiver is the better asset; it cares who is projected higher this week,
 * who is on bye, and who is hurt.
 *
 * So this module asks the same question `lib/needs/lineup.ts` asks, over a
 * different column. `bestLineup` already solves a roster against the league's
 * own starting slots and is already proved optimal on laminar eligibility
 * sets; what is new here is the *second* lineup — the one the manager has
 * actually slotted — and the difference between the two, which is the
 * suggestion.
 *
 * Pure, with no `server-only`: the store next door reads the two tables and
 * this decides what they mean, so every claim on the screen is unit-testable
 * without a database or a live NFL week.
 */
import { bestLineup, type Lineup, type LineupPlayer } from "@/lib/needs/lineup";
import type { StartingSlot } from "@/lib/values/vor";

/**
 * One rostered player, for one week.
 *
 * `points` is the field `bestLineup` solves on, and it is this week's
 * projection rather than the rest of the season's. Null is not zero, for the
 * same reason it is not zero anywhere else in the app: a player nothing
 * projects is a player we have no claim about, and inventing a zero for him
 * would let a lineup "improve" by benching him.
 */
export type WeekPlayer = LineupPlayer & {
  playerId: number;
  name: string;
  position: string | null;
  nflTeam: string | null;
  injuryStatus: string | null;
  headshotUrl: string | null;
  /** The roster slot he currently occupies: "QB", "W/R/T", "BN", "IR". */
  slot: string | null;
  /** Whether the provider (or the roster editor) has him in a starting slot. */
  isStarter: boolean;
  /** This week's projection, in this league's scoring. Null when there is none. */
  points: number | null;
  /** What he actually scored, once the week has been played. */
  actual: number | null;
  /** Who his NFL team plays this week. Null on a bye, or before the slate lands. */
  opponent: string | null;
  isHome: boolean;
  /**
   * True only when the slate for this week is known and his team has no game
   * in it. A missing slate leaves this false rather than calling everybody
   * rested, because "we did not look" is not "he is off".
   */
  onBye: boolean;
};

/** What the manager currently has out, whether or not it is the best he can do. */
export type CurrentLineup<T extends WeekPlayer = WeekPlayer> = {
  /** Players sitting in a starting slot right now. */
  starters: T[];
  /** Σ of their projections. Players with none contribute nothing and are counted. */
  points: number;
  /** Σ of what they actually scored, once the week is played. Null before that. */
  actual: number | null;
  /** Starters this week's grid has no projection for, so the total cannot see them. */
  unprojected: number;
  /** Starters whose NFL team is on bye. The strongest sit signal there is. */
  onBye: number;
  /** Starting slots with nobody in them at all. */
  empty: number;
};

/**
 * One line of the advice: a player to start, a player to sit, and what the
 * swap is worth.
 *
 * Either side can be null and both cases are real. An empty starting slot
 * gives a start with nobody to sit; a lineup with more starters than the
 * league has seats gives a sit with nobody to promote.
 */
export type StartSitMove<T extends WeekPlayer = WeekPlayer> = {
  /**
   * Where the optimal lineup seats the incoming player, which is not always
   * the seat the man he replaces was sitting in: promoting a receiver can put
   * *him* at WR and push the receiver already there into the flex. It is a
   * label on the move rather than an instruction, because the seat a manager
   * ends up using is his provider's business and every legal arrangement of
   * the same eight names scores the same.
   */
  slot: string | null;
  start: T | null;
  sit: T | null;
  /** Projected points this one swap adds. */
  gain: number;
};

export type WeekLineup<T extends WeekPlayer = WeekPlayer> = {
  current: CurrentLineup<T>;
  /** The best this roster can do against the league's own slots. */
  best: Lineup<T>;
  /** `best − current`, in projected points for this week. */
  gain: number;
  moves: StartSitMove<T>[];
  /** Starting seats the league's slots define, which is what `best` fills. */
  seats: number;
};

/**
 * Below this a lineup is called optimal rather than improved.
 *
 * A weekly projection is a point estimate with a standard error of several
 * points; a rearrangement worth a quarter of one is inside the noise of the
 * number that recommended it. Saying "start him, it is worth 0.2" is not
 * advice, it is false precision with a button on it. The threshold is
 * deliberately low all the same: half a point a week is three points over a
 * season, and fantasy weeks are lost by less.
 */
export const MIN_GAIN = 0.5;

/**
 * The pairing that turns a set difference into readable advice.
 *
 * The optimal lineup and the current one share most of their players; what
 * differs is a set coming in and a set going out. Because everyone else is
 * common to both, `Σ in − Σ out` is exactly `best − current`, and *any*
 * pairing of the two sets sums to the same total. So the pairing is chosen for
 * legibility rather than for arithmetic: the biggest gain first, against the
 * weakest player it displaces.
 *
 * Unprojected starters sort to the front of the sit list. They are never in
 * the optimal lineup — `bestLineup` will not seat a player it cannot score —
 * and a starter with no projection at all is the least defensible name in the
 * lineup, usually because he is on bye.
 */
function pairMoves<T extends WeekPlayer>(
  starters: T[],
  best: Lineup<T>,
): StartSitMove<T>[] {
  const starting = new Set(starters.map((player) => player.playerId));
  const optimal = new Set(
    best.slots
      .map((seat) => seat.player?.playerId)
      .filter((id): id is number => id !== undefined),
  );

  const incoming = best.slots
    .filter(
      (seat): seat is { slot: string; player: T } =>
        seat.player !== null && !starting.has(seat.player.playerId),
    )
    .sort((a, b) => (b.player.points ?? 0) - (a.player.points ?? 0));

  const outgoing = starters
    .filter((player) => !optimal.has(player.playerId))
    .sort(
      (a, b) =>
        (a.points ?? Number.NEGATIVE_INFINITY) -
        (b.points ?? Number.NEGATIVE_INFINITY),
    );

  const moves: StartSitMove<T>[] = [];

  for (let index = 0; index < Math.max(incoming.length, outgoing.length); index += 1) {
    const start = incoming[index] ?? null;
    const sit = outgoing[index] ?? null;

    moves.push({
      slot: start?.slot ?? sit?.slot ?? null,
      start: start?.player ?? null,
      sit,
      // A player with no projection contributes nothing on either side, which
      // is the same arithmetic the two lineup totals do.
      gain: (start?.player.points ?? 0) - (sit?.points ?? 0),
    });
  }

  return moves;
}

/** Σ of a field over the players that have one, or null when none does. */
function total<T extends WeekPlayer>(
  players: T[],
  read: (player: T) => number | null,
): number | null {
  const present = players
    .map(read)
    .filter((value): value is number => value !== null);

  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0);
}

/**
 * One team's week: what is slotted, what should be, and the difference.
 *
 * The current lineup is read off `isStarter` rather than re-derived from the
 * slot name, because that flag is the one both providers and the manual roster
 * editor write, and it is already the field every other screen totals. The
 * *optimal* lineup ignores it entirely — a running back parked in a flex is a
 * flex-eligible player like any other, and where the league's own slots put
 * him is `bestLineup`'s business.
 */
export function weekLineup<T extends WeekPlayer>(
  players: T[],
  slots: StartingSlot[],
): WeekLineup<T> {
  const best = bestLineup(players, slots);
  const starters = players.filter((player) => player.isStarter);

  const current: CurrentLineup<T> = {
    starters,
    points: total(starters, (player) => player.points) ?? 0,
    actual: total(starters, (player) => player.actual),
    unprojected: starters.filter((player) => player.points === null).length,
    onBye: starters.filter((player) => player.onBye).length,
    empty: Math.max(0, best.slots.length - starters.length),
  };

  return {
    current,
    best,
    gain: best.points - current.points,
    moves: pairMoves(starters, best),
    seats: best.slots.length,
  };
}

/** Whether this week's lineup is worth touching at all. */
export function isOptimal<T extends WeekPlayer>(lineup: WeekLineup<T>): boolean {
  return lineup.gain < MIN_GAIN;
}

/**
 * Which players the advice disagrees with the manager about, by id.
 *
 * The roster list draws the same verdict in place, beside the player, rather
 * than only in a summary above it: "sit him" next to his name is a decision,
 * where a name in a list somewhere else is a lookup. Both halves read this one
 * map so they can never disagree.
 */
export type WeekVerdict = "start" | "sit";

export function verdicts<T extends WeekPlayer>(
  lineup: WeekLineup<T>,
): Map<number, WeekVerdict> {
  const map = new Map<number, WeekVerdict>();
  if (isOptimal(lineup)) return map;

  for (const move of lineup.moves) {
    if (move.start) map.set(move.start.playerId, "start");
    if (move.sit) map.set(move.sit.playerId, "sit");
  }

  return map;
}

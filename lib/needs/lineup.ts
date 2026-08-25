/**
 * The optimal starting lineup, and the delta a trade makes to it (§6).
 *
 * §6 asks for "each team's starting-lineup projected points before vs. after
 * the trade", calls it what makes a trade *good for you* as opposed to merely
 * *even*, and names it the objective function §7's suggestion engines optimize.
 * Phase 6 left the seam and this fills it: a second scorer over the same two
 * packages, pure and local, so it runs in the browser on every keystroke beside
 * `analyzeTrade` (§2).
 *
 * It stays *secondary*. §1.5 is explicit — "trade evaluation is value-first,
 * context-second" — so nothing here touches the fairness band. The verdict
 * still answers "is this fair"; this answers "does it help", and those are
 * different questions that deserve different answers on the same screen.
 */
import { normalizePosition } from "@/lib/crosswalk/resolve";
import { eligiblePositions, type StartingSlot } from "@/lib/values/vor";

export type LineupPlayer = {
  playerId: number;
  position: string | null;
  /** Rest-of-season projected points. Null means nothing projects them. */
  points: number | null;
};

export type FilledSlot<T extends LineupPlayer = LineupPlayer> = {
  slot: string;
  player: T | null;
};

export type Lineup<T extends LineupPlayer = LineupPlayer> = {
  points: number;
  slots: FilledSlot<T>[];
  /** Starting slots no eligible projected player was left to fill. */
  empty: number;
  /** Players on the roster with no projection, so no claim on a slot. */
  unprojected: number;
};

/**
 * Which positions a starting slot accepts.
 *
 * `eligiblePositions` covers the four scoring positions and every flex spelling
 * Yahoo uses, and answers empty for everything else — including `D/ST`, which
 * it refuses on purpose so a defense is never mistaken for a flex. K and DEF
 * are named slots that no flex has ever accepted, so they resolve directly.
 */
export function slotAccepts(slot: string): string[] {
  const flex = eligiblePositions(slot);
  if (flex.length > 0) return flex;

  const direct = normalizePosition(slot);
  return direct === "K" || direct === "DEF" ? [direct] : [];
}

/**
 * The best starting lineup a roster can put out, by projection.
 *
 * Greedy, filling the most restrictive slot first — and that is optimal here
 * rather than merely convenient. Fantasy eligibility sets are *laminar*: `{RB}`
 * sits inside `{RB, WR, TE}` sits inside `{QB, RB, WR, TE}`, and any two sets
 * are either nested or disjoint. On a laminar family, taking the best eligible
 * player for the narrowest slot first can never strand a better assignment,
 * because anyone that slot could have taken instead is still eligible for every
 * wider slot behind it. A general bipartite matching would be the right tool
 * for a league whose slots overlap partially, and no such league exists.
 *
 * Players with no projection are not candidates. They may well be startable —
 * that is a claim this app has no evidence for, and inventing a zero would let
 * a lineup "improve" by shedding them.
 */
export function bestLineup<T extends LineupPlayer>(
  players: T[],
  slots: StartingSlot[],
): Lineup<T> {
  const seats: { slot: string; accepts: Set<string> }[] = [];

  for (const slot of slots) {
    if (!slot.isStarting || slot.count <= 0) continue;
    const accepts = slotAccepts(slot.position);
    if (accepts.length === 0) continue;

    for (let index = 0; index < slot.count; index += 1) {
      seats.push({ slot: slot.position, accepts: new Set(accepts) });
    }
  }

  // Narrowest first. Stable, so two same-width slots keep the league's own
  // ordering rather than an arbitrary one.
  seats.sort((a, b) => a.accepts.size - b.accepts.size);

  const available = players
    .filter((player) => player.points !== null)
    .map((player) => ({
      player,
      position: normalizePosition(player.position),
      points: player.points as number,
    }))
    .sort((a, b) => b.points - a.points);

  const taken = new Set<number>();
  const filled: FilledSlot<T>[] = [];
  let points = 0;
  let empty = 0;

  for (const seat of seats) {
    const pick = available.find(
      (entry) =>
        !taken.has(entry.player.playerId) &&
        entry.position !== null &&
        seat.accepts.has(entry.position),
    );

    if (!pick) {
      filled.push({ slot: seat.slot, player: null });
      empty += 1;
      continue;
    }

    taken.add(pick.player.playerId);
    points += pick.points;
    filled.push({ slot: seat.slot, player: pick.player });
  }

  return {
    points,
    slots: filled,
    empty,
    unprojected: players.length - available.length,
  };
}

export type LineupChange = {
  before: number;
  after: number;
  /** `after − before`, in projected points over the rest of the season. */
  delta: number;
  /** Starting slots the roster cannot fill after the trade. */
  empty: number;
  /**
   * Players moving in or out with no projection. The delta cannot see them, and
   * §5's rule is that a number the app cannot stand behind gets said out loud
   * rather than folded in.
   */
  unprojected: number;
};

/**
 * What a package does to one team's starting lineup.
 *
 * Both lineups are re-solved from scratch rather than diffed, because a trade
 * changes who *else* starts: sending the third-best running back away is free
 * until the flex spot has nobody left to take, and a diff of the two rosters
 * would never notice.
 */
export function lineupChange<T extends LineupPlayer>(
  roster: T[],
  { out, in: incoming }: { out: T[]; in: T[] },
  slots: StartingSlot[],
): LineupChange {
  const leaving = new Set(out.map((player) => player.playerId));
  const after = [
    ...roster.filter((player) => !leaving.has(player.playerId)),
    ...incoming,
  ];

  const before = bestLineup(roster, slots);
  const next = bestLineup(after, slots);

  const moving = [...out, ...incoming];

  return {
    before: before.points,
    after: next.points,
    delta: next.points - before.points,
    empty: next.empty,
    unprojected: moving.filter((player) => player.points === null).length,
  };
}

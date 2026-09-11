/**
 * A lineup in the order a lineup is read in.
 *
 * `loadLeagueRosters` sorts a roster by the *player's* position, which is the
 * right order for a trade conversation and the wrong one for a matchup. It
 * puts a running back in the flex among the running backs and a receiver in
 * the flex among the receivers, so a manager reading two lineups side by side
 * cannot see which seat anyone is in — and the flex is exactly the seat worth
 * seeing, because it is the only one he chose the shape of.
 *
 * So this re-sorts a starting lineup by *seat*, in one fixed order:
 *
 *     QB · RB · WR · TE · flex · K · DEF
 *
 * Fixed, and not the league's own. `roster_slots` arrives in whatever order a
 * provider's settings payload happened to list it, which is a fact about the
 * payload rather than about football — Yahoo commonly puts its flex between
 * the receivers and the tight end, which reads as a lineup with a hole in it.
 * The order above is the one every fantasy site prints and the one a manager
 * already has in their head: the four scoring positions in depth-chart order,
 * then whatever is left over, then the two that are nobody's decision.
 *
 * Pure, and sorting rather than grouping: the input is already ordered
 * sensibly within a position, and a stable sort keeps that as the tiebreak.
 */
import { eligiblePositions } from "@/lib/values/vor";

/**
 * Spellings that name one seat. Both providers are inconsistent about these
 * between the settings payload and the roster rows themselves — a Yahoo league
 * can call the slot `DEF` in its settings and stamp `D/ST` on the player
 * sitting in it, and matching those two strings literally would file the
 * defense as a slot the league does not have.
 */
const ALIASES: Record<string, string> = {
  DST: "DEF",
  "D/ST": "DEF",
  "D/ST/K": "DEF",
  PK: "K",
};

/**
 * The canonical name of a seat.
 *
 * A flex is keyed by what it can hold rather than by what it is called, so
 * Yahoo's `W/R/T` and its occasional `FLEX` for the same slot resolve to one
 * key. Everything else — including the two positions `eligiblePositions`
 * deliberately does not know about, kicker and defense — keys on its own name
 * through the alias table.
 */
export function slotKey(slot: string): string {
  const upper = slot.trim().toUpperCase();
  const eligible = eligiblePositions(upper);
  if (eligible.length > 1) return [...eligible].sort().join("/");
  return ALIASES[upper] ?? upper;
}

/** The seat order, as a rank per canonical slot name. */
const ORDER: Record<string, number> = {
  QB: 0,
  RB: 1,
  WR: 2,
  TE: 3,
  K: 5,
  DEF: 6,
};

/** Between the tight end and the kicker: every seat that holds more than one position. */
const FLEX = 4;

/** A seat this app cannot name. After everything it can. */
const UNNAMED = 7;

/** Where an unnamed seat's occupant falls among the other unnamed ones. */
const BY_POSITION = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * A seat's place in the order, and its place among seats that share it.
 *
 * Two ranks rather than one because the flexes are a group rather than a seat:
 * a league with both a flex and a superflex has two kinds of leftover seat,
 * and the narrower comes first — `W/R/T` takes three positions and `Q/W/R/T`
 * takes four, so the one with fewer ways to fill it is the more constrained
 * decision and reads first, exactly as RB reads before the flex that could
 * also have held him.
 */
function rankOf(slot: string | null, position: string | null): [number, number] {
  if (slot === null) return [UNNAMED, byPosition(position)];

  const named = ORDER[slotKey(slot)];
  if (named !== undefined) return [named, 0];

  const width = eligiblePositions(slot).length;
  if (width > 1) return [FLEX, width];

  return [UNNAMED, byPosition(position)];
}

function byPosition(position: string | null): number {
  const index = BY_POSITION.indexOf((position ?? "").toUpperCase());
  return index === -1 ? BY_POSITION.length : index;
}

/**
 * Where one seat falls against another, for anything that lists seats.
 *
 * Exported because two surfaces list them: the matchup screen sorts players by
 * the seat each is in, and the lineup board lays out the seats themselves. A
 * manager who sets a lineup and then looks at the matchup should be reading
 * the same ten rows in the same ten places, which they cannot be if each
 * surface decides the order for itself.
 */
export function compareSeats(
  a: { slot: string | null; position: string | null },
  b: { slot: string | null; position: string | null },
): number {
  const left = rankOf(a.slot, a.position);
  const right = rankOf(b.slot, b.position);
  return left[0] - right[0] || left[1] - right[1];
}

/**
 * Sort a starting lineup into seat order.
 *
 * Players sharing a seat — two running backs, two flexes — share a rank and
 * keep the order they arrived in, which is the roster's position-then-value
 * order, so the better of two backs is still the one listed first. A player in
 * a seat this app cannot name sorts after every one it can, by his own
 * position, rather than vanishing to the end in arrival order: an unreadable
 * slot is a gap in what we know, and the lineup is still a lineup.
 */
export function bySlotOrder<T extends { slot: string | null; position: string | null }>(
  starters: T[],
): T[] {
  // Decorated rather than compared in place: `Array.prototype.sort` is stable
  // in every engine this runs on, and the index tiebreak makes that explicit
  // rather than relied upon.
  return starters
    .map((player, index) => ({ player, index }))
    .sort((a, b) => compareSeats(a.player, b.player) || a.index - b.index)
    .map((entry) => entry.player);
}

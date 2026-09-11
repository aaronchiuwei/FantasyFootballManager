/**
 * A lineup in the order the league itself lists it.
 *
 * `loadLeagueRosters` sorts a roster by the *player's* position, which is the
 * right order for a trade conversation and the wrong one for a matchup. It
 * puts a running back in the flex among the running backs and a receiver in
 * the flex among the receivers, so a manager reading two lineups side by side
 * cannot see which seat anyone is in — and the flex is exactly the seat worth
 * seeing, because it is the only one he chose the shape of.
 *
 * So this re-sorts a starting lineup into the league's own slot order: the
 * order `roster_slots` lists, which is the order the provider's own lineup
 * page prints. Nothing here decides what that order should be. A league that
 * puts its flex after the receivers gets it there; a league that puts it after
 * the tight end gets it there.
 *
 * Pure, and sorting rather than grouping: the input is already ordered
 * sensibly within a position, and a stable sort keeps that as the tiebreak.
 */
import { eligiblePositions, type StartingSlot } from "@/lib/values/vor";

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

/** Where a roster's own order puts a player whose seat the league does not list. */
const FALLBACK_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Sort a starting lineup into the league's own slot order.
 *
 * Players sharing a seat — two running backs, two flexes — share a rank and
 * keep the order they arrived in, which is the roster's position-then-value
 * order. A player in a seat `roster_slots` does not list sorts after every one
 * it does, by position, rather than vanishing to the end in arrival order: an
 * unlisted seat is a settings gap, and the lineup is still a lineup.
 */
export function bySlotOrder<T extends { slot: string | null; position: string | null }>(
  starters: T[],
  slots: StartingSlot[],
): T[] {
  const ranks = new Map<string, number>();

  for (const slot of slots) {
    if (!slot.isStarting || slot.count <= 0) continue;
    const key = slotKey(slot.position);
    // First mention wins. A league that lists a seat twice rather than
    // carrying a count still reads in the order it listed them.
    if (!ranks.has(key)) ranks.set(key, ranks.size);
  }

  const unlisted = ranks.size;

  const rank = (player: T): number => {
    const seat = player.slot === null ? null : ranks.get(slotKey(player.slot));
    if (seat !== undefined && seat !== null) return seat;

    const position = (player.position ?? "").toUpperCase();
    const index = FALLBACK_ORDER.indexOf(position);
    return unlisted + (index === -1 ? FALLBACK_ORDER.length : index);
  };

  // Decorated rather than compared in place: `Array.prototype.sort` is stable
  // in every engine this runs on, and the index tiebreak makes that explicit
  // rather than relied upon.
  return starters
    .map((player, index) => ({ player, index, rank: rank(player) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.player);
}

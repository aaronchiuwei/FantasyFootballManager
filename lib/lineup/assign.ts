/**
 * Which seat every rostered player sits in.
 *
 * `bestLineup` answers "what is the best lineup this roster can put out" and
 * has since Phase 7, but nothing could ever *act* on the answer. An imported
 * league's lineup belongs to its provider — stage 7 overwrites `is_starter` on
 * every sync, so writing one here would be work that vanishes — and a hand-kept
 * league had only the roster editor, where a lineup is set one player at a time
 * by choosing a slot for each of fifteen men and hoping the total comes out
 * right. The optimal lineup was advice nobody could take.
 *
 * This is the other half: the solver's answer turned into an assignment that
 * can be written, and the two edits a manager makes to one by hand.
 *
 * Pure, and separate from the writer next door, because "who should be at
 * flex" and "what happens to the man he displaces" are claims about a lineup
 * rather than about a database.
 */
import { bestLineup, slotFits, type LineupPlayer } from "@/lib/needs/lineup";
import type { StartingSlot } from "@/lib/values/vor";

/** The bench. Where a player goes when he is in no starting seat. */
export const BENCH = "BN";

/**
 * Slots that hold a player out of the lineup deliberately, rather than by
 * being beaten to a seat. Mirrors `lib/leagues/rosters.ts`, which decides the
 * same thing for the band a roster row is read in.
 */
const RESERVE = ["IR", "IR+", "NA", "IL"];

export function isReserveSlot(slot: string | null): boolean {
  return slot !== null && RESERVE.includes(slot.trim().toUpperCase());
}

/** A rostered player, as the assignment reads him. */
export type Seatable = LineupPlayer & {
  /** Where he sits now. Null and `BN` both mean the bench. */
  slot: string | null;
};

/**
 * One row of the lineup board: a seat, and whoever is in it.
 *
 * The database stores a slot name and not a seat, so a league with two running
 * back slots has two rows both saying `RB` and two players both stored as
 * `RB`. Pairing them off by order is the whole of what a "seat" is here — it
 * is presentational, and every write below goes through the slot name, so
 * nothing depends on a manager and this function agreeing about which RB is
 * the first one.
 */
export type Seat<T extends Seatable = Seatable> = {
  /** Stable within one board: the slot name and its index among its own kind. */
  key: string;
  slot: string;
  player: T | null;
};

/**
 * The league's starting seats, in the league's own order, filled from a roster.
 *
 * A player in a starting slot the league does not have — a lineup that was
 * legal before the settings changed — is not dropped. He keeps his row at the
 * end, where the manager can see him and move him, rather than quietly
 * counting toward a total in a seat that no longer exists.
 */
export function seats<T extends Seatable>(
  players: T[],
  slots: StartingSlot[],
): Seat<T>[] {
  const pool = new Map<string, T[]>();
  for (const player of players) {
    if (player.slot === null || isReserveSlot(player.slot)) continue;
    const key = player.slot.trim().toUpperCase();
    if (key === BENCH) continue;
    pool.set(key, [...(pool.get(key) ?? []), player]);
  }

  const built: Seat<T>[] = [];

  for (const slot of slots) {
    if (!slot.isStarting || slot.count <= 0) continue;
    const key = slot.position.trim().toUpperCase();

    for (let index = 0; index < slot.count; index += 1) {
      built.push({
        key: `${key}#${index}`,
        slot: slot.position,
        player: pool.get(key)?.shift() ?? null,
      });
    }
  }

  // Whatever is left is a player in a starting slot this league no longer
  // lists, or more men in one slot than it has seats for. Both are real states
  // a settings change can leave behind, and both are the manager's to fix.
  for (const [key, left] of pool) {
    left.forEach((player, index) => {
      built.push({ key: `${key}!${index}`, slot: player.slot ?? key, player });
    });
  }

  return built;
}

/**
 * The slot every player should be in for the best lineup this roster can field.
 *
 * Reserve is left alone. A player on IR is held out of the lineup on purpose
 * and by a rule the app does not model — he is hurt — so sweeping him into the
 * solve would seat a man who cannot play and sweeping him to the bench would
 * quietly undo a decision the manager made for a reason.
 *
 * Everyone else is either seated by `bestLineup` or benched. Benching the rest
 * explicitly is the point: a lineup that is optimal *and* leaves a stale
 * starter behind is not optimal, it is over-full, and `is_starter` would then
 * be counted by every screen that totals starters.
 */
export function bestAssignment<T extends Seatable>(
  players: T[],
  slots: StartingSlot[],
): Map<number, string> {
  const assignment = new Map<number, string>();
  const available: T[] = [];

  for (const player of players) {
    if (isReserveSlot(player.slot)) {
      assignment.set(player.playerId, player.slot!);
      continue;
    }
    available.push(player);
  }

  const best = bestLineup(available, slots);

  for (const seat of best.slots) {
    if (seat.player) assignment.set(seat.player.playerId, seat.slot);
  }

  for (const player of available) {
    if (!assignment.has(player.playerId)) {
      assignment.set(player.playerId, BENCH);
    }
  }

  return assignment;
}

/** What a seating move writes: a player, and the slot he ends up in. */
export type SeatMove = { playerId: number; slot: string };

/**
 * Put a player in a seat, and say where that leaves the man who was in it.
 *
 * A swap where a swap is legal, a benching where it is not. Picking the flex's
 * receiver for an empty WR seat should not cost the lineup its flex, and
 * picking a bench player for it should not leave the displaced starter
 * secretly still starting.
 *
 * Both cases come out of one question: does the outgoing player fit the seat
 * the incoming player is leaving? A man coming off the bench leaves no seat, so
 * the answer is no and the outgoing player is benched, which is the same branch
 * rather than a special case.
 */
export function seatMoves<T extends Seatable>(
  players: T[],
  slot: string,
  incomingId: number | null,
  outgoingId: number | null,
): SeatMove[] {
  const moves: SeatMove[] = [];

  if (incomingId === null) {
    return outgoingId === null ? moves : [{ playerId: outgoingId, slot: BENCH }];
  }

  const incoming = players.find((player) => player.playerId === incomingId);
  if (!incoming) return moves;

  moves.push({ playerId: incomingId, slot });

  if (outgoingId === null || outgoingId === incomingId) return moves;

  const outgoing = players.find((player) => player.playerId === outgoingId);
  if (!outgoing) return moves;

  const vacated =
    incoming.slot === null ||
    isReserveSlot(incoming.slot) ||
    incoming.slot.trim().toUpperCase() === BENCH
      ? null
      : incoming.slot;

  const swappable =
    vacated !== null &&
    vacated.trim().toUpperCase() !== slot.trim().toUpperCase() &&
    slotFits(vacated, outgoing.position);

  moves.push({ playerId: outgoingId, slot: swappable ? vacated : BENCH });

  return moves;
}

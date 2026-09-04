/**
 * What a move is, before anything is written down.
 *
 * A hand-kept league's rosters change the same four ways every league's do —
 * someone is added, someone is dropped, both at once, or two teams swap. This
 * module is that vocabulary, and the rules that make a proposed move coherent.
 *
 * Pure, because the rules are the part worth being sure of and none of them
 * need a database to check. `lib/transactions/store.ts` is what applies a move
 * that passed through here.
 */

export const MOVE_KINDS = ["add", "drop", "add_drop", "trade"] as const;

export type MoveKind = (typeof MOVE_KINDS)[number];

export function isMoveKind(value: string): value is MoveKind {
  return (MOVE_KINDS as readonly string[]).includes(value);
}

/**
 * One player moving one way.
 *
 * `null` on a side means "outside the league": a null `fromTeamId` is the free
 * agent pool or waivers, a null `toTeamId` is a player cut back to it. That is
 * the same convention `transaction_items` stores, deliberately — a move is
 * legible in the database in the shape it was proposed in.
 */
export type MoveItem = {
  playerId: number;
  fromTeamId: string | null;
  toTeamId: string | null;
};

export const MOVE_LABELS: Record<MoveKind, string> = {
  add: "Add",
  drop: "Drop",
  add_drop: "Add / drop",
  trade: "Trade",
};

/**
 * What a set of items adds up to.
 *
 * Derived rather than declared. The form already says which players go where,
 * and asking a second time for a name for it is asking the user to agree with
 * themselves — a "trade" whose items are two adds would be a row that lies
 * about itself forever after.
 */
export function kindFor(items: MoveItem[]): MoveKind | null {
  let adds = 0;
  let drops = 0;
  let swaps = 0;

  for (const item of items) {
    if (item.fromTeamId !== null && item.toTeamId !== null) swaps += 1;
    else if (item.toTeamId !== null) adds += 1;
    else if (item.fromTeamId !== null) drops += 1;
  }

  if (swaps > 0) return "trade";
  if (adds > 0 && drops > 0) return "add_drop";
  if (adds > 0) return "add";
  if (drops > 0) return "drop";
  return null;
}

/**
 * Whether a move can be recorded, and if not, why in one sentence.
 *
 * The rules are all the same rule seen from different sides: a move has to
 * describe an actual change of ownership. A player who appears twice, a leg
 * that starts and ends on the same roster, a trade with only one team in it —
 * each of those is a form half-filled, and each would leave a history entry
 * that reads as nonsense next to the roster it produced.
 */
export function validateMove(items: MoveItem[]): string | null {
  if (items.length === 0) return "Pick at least one player.";

  const seen = new Set<number>();
  for (const item of items) {
    if (item.fromTeamId === null && item.toTeamId === null) {
      return "A player has to come from somewhere or go somewhere.";
    }
    if (item.fromTeamId !== null && item.fromTeamId === item.toTeamId) {
      return "A player cannot be traded to the team that already has him.";
    }
    if (seen.has(item.playerId)) {
      return "The same player appears twice in this move.";
    }
    seen.add(item.playerId);
  }

  const kind = kindFor(items);
  if (kind === null) return "Nothing about this move changes a roster.";

  // A leg with an open end inside a trade is a drop wearing a trade's name.
  // Recording it would make the history say a team received a player it never
  // did. Two distinct teams then follow from the checks above rather than
  // needing one of their own: every leg has both ends, and no leg's ends are
  // the same team.
  if (
    kind === "trade" &&
    items.some((item) => item.fromTeamId === null || item.toTeamId === null)
  ) {
    return "Every player in a trade needs a team on both ends.";
  }

  return null;
}

/** The teams a move touches, for the "who does this affect" line on a row. */
export function teamsInMove(items: MoveItem[]): string[] {
  const teams = new Set<string>();
  for (const item of items) {
    if (item.fromTeamId) teams.add(item.fromTeamId);
    if (item.toTeamId) teams.add(item.toTeamId);
  }
  return [...teams];
}

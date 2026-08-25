/**
 * Value over replacement (§5, Tier B).
 *
 * ```
 * replacement_rank(pos) = teams × (starters_at_pos + flex_share(pos))
 * baseline(pos)         = projected_points of the player at replacement_rank(pos)
 * VOR(p)                = projected_points(p) − baseline(position(p))
 * ```
 *
 * Everything here is a pure function of the league's own roster slots — no
 * league shape is hardcoded, because the whole point of reading settings from
 * Yahoo (§1.2) is that a 10-team superflex prices its bench differently than a
 * 12-team single-QB league.
 */
import { normalizePosition } from "@/lib/crosswalk/resolve";

/** The positions VOR is computed over. K/DEF are handled by the cap (§5). */
export const SCORING_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type ScoringPosition = (typeof SCORING_POSITIONS)[number];

/** An NFL fantasy regular season, used to scale season totals to a week rate. */
export const SEASON_WEEKS = 17;

/**
 * How a flex slot actually gets filled, by position. The plan's ~0.5/0.4/0.1
 * split for a standard W/R/T flex falls out of these weights, normalized over
 * whichever positions the slot accepts.
 *
 * QB's weight is an order of magnitude larger for one reason: a superflex slot
 * is filled by a quarterback nearly every week, because the QB scoring
 * distribution sits well above the RB/WR one. A slot that accepts a QB is a QB
 * slot in all but name.
 */
export const FLEX_FILL_WEIGHTS: Record<ScoringPosition, number> = {
  QB: 5,
  RB: 0.5,
  WR: 0.4,
  TE: 0.1,
};

/** Yahoo writes flex slots as slash-joined initials: `W/R/T`, `Q/W/R/T`. */
const FLEX_LETTERS: Record<string, ScoringPosition> = {
  Q: "QB",
  W: "WR",
  R: "RB",
  T: "TE",
};

export type StartingSlot = {
  position: string;
  count: number;
  isStarting: boolean;
};

/**
 * Which positions a starting slot can be filled by. A named position maps to
 * itself; a slash form expands; `FLEX` is Yahoo's occasional spelling of
 * `W/R/T`. Anything unrecognized returns empty rather than guessing.
 */
export function eligiblePositions(slot: string): ScoringPosition[] {
  const upper = slot.trim().toUpperCase();
  if (upper === "") return [];
  if (upper === "FLEX") return ["RB", "WR", "TE"];

  const direct = normalizePosition(upper);
  if (direct && (SCORING_POSITIONS as readonly string[]).includes(direct)) {
    return [direct as ScoringPosition];
  }

  const letters = upper.split("/");
  if (letters.length < 2) return [];

  const positions = new Set<ScoringPosition>();
  for (const letter of letters) {
    const position = FLEX_LETTERS[letter.trim()];
    // A slash form we cannot read whole is not a flex slot — `D/ST` reaches
    // here and must not be mistaken for a defense/special-teams flex.
    if (!position) return [];
    positions.add(position);
  }

  return [...positions];
}

/**
 * Starting slots per team, per position, with flex slots distributed across
 * the positions that fill them. Fractional by construction.
 */
export function starterCounts(
  slots: StartingSlot[],
): Record<ScoringPosition, number> {
  const counts: Record<ScoringPosition, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };

  for (const slot of slots) {
    if (!slot.isStarting || slot.count <= 0) continue;

    const eligible = eligiblePositions(slot.position);
    if (eligible.length === 0) continue;

    if (eligible.length === 1) {
      counts[eligible[0]] += slot.count;
      continue;
    }

    const total = eligible.reduce((sum, pos) => sum + FLEX_FILL_WEIGHTS[pos], 0);
    for (const position of eligible) {
      counts[position] += (slot.count * FLEX_FILL_WEIGHTS[position]) / total;
    }
  }

  return counts;
}

/**
 * The rank at which a position stops being a starter and becomes replaceable.
 * A 12-team league starting 2 RB plus one W/R/T flex puts RB replacement at
 * 12 × (2 + 0.5) = 30.
 */
export function replacementRanks(
  slots: StartingSlot[],
  numTeams: number,
): Record<ScoringPosition, number> {
  const teams = Math.max(1, numTeams);
  const starters = starterCounts(slots);
  const ranks = {} as Record<ScoringPosition, number>;

  for (const position of SCORING_POSITIONS) {
    // A league that starts none of a position still has a replacement level:
    // rank 1, i.e. everyone at that position is replaceable.
    ranks[position] = Math.max(1, teams * starters[position]);
  }

  return ranks;
}

/**
 * The score at a possibly fractional rank in a descending list, interpolated
 * between its neighbours. Ranks are 1-based. Past the end of the list the
 * baseline is the last player's score — a position thinner than its own
 * replacement level has no true replacement, and pretending it is zero would
 * hand every player at that position a huge free VOR.
 */
export function baselineAt(pointsDescending: number[], rank: number): number {
  if (pointsDescending.length === 0) return 0;
  if (rank <= 1) return pointsDescending[0];
  if (rank >= pointsDescending.length) {
    return pointsDescending[pointsDescending.length - 1];
  }

  const lower = Math.floor(rank);
  const fraction = rank - lower;
  const a = pointsDescending[lower - 1];
  const b = pointsDescending[lower];
  return a + (b - a) * fraction;
}

/**
 * Rest-of-season points for one player.
 *
 * Two corrections, in order. First the plan's preseason degradation (§5): a
 * season projection is all we have until games are played, then actual pace is
 * blended in at a weight that rises with games played and tops out at 0.7 —
 * the market has always seen the same games we have, so the model tier has to
 * as well or it prices a breakout off August's opinion in November.
 *
 * Then the redraft scaling of §6: a redraft asset is a claim on the weeks that
 * are left and nothing more.
 */
export function restOfSeasonPoints({
  projectedPoints,
  actualPoints,
  gamesPlayed,
  weeksRemaining,
}: {
  projectedPoints: number | null;
  actualPoints: number | null;
  gamesPlayed: number | null;
  weeksRemaining: number;
}): number | null {
  if (projectedPoints === null && actualPoints === null) return null;

  const played = gamesPlayed ?? 0;
  const weight = played > 0 ? Math.min(0.7, played / 10) : 0;
  const projected = projectedPoints ?? 0;

  const pace =
    played > 0 && actualPoints !== null
      ? (actualPoints / played) * SEASON_WEEKS
      : projected;

  const seasonPoints = (1 - weight) * projected + weight * pace;
  const weeks = Math.min(SEASON_WEEKS, Math.max(0, weeksRemaining));
  return (seasonPoints * weeks) / SEASON_WEEKS;
}

/**
 * A head-to-head week, read while it is still being played.
 *
 * Every other screen in this app answers a question about the season: what a
 * player is worth, what a roster is short of, what a trade does to the weeks
 * that are left. Even the start/sit board, which is weekly, is asking a
 * question about a decision rather than about an outcome. This module asks the
 * only question a manager has on a Sunday afternoon — am I winning — and the
 * honest answer to that is not a score, it is a distribution.
 *
 * So the model here is deliberately small and stated out loud. A side's final
 * score is what the league has already credited it plus what its starters who
 * have not played yet are projected for. The first half is settled and the
 * second is not, so all of the uncertainty lives in the players still to come,
 * and it shrinks as the afternoon goes on until, with nobody left, the
 * probability is 1 or 0 and the screen stops guessing.
 *
 * Pure and free of `server-only` for the reason the start/sit math is: a claim
 * as loud as "you are an 82% favourite" has to be testable without a database
 * and without an actual live NFL Sunday to point at.
 */

/**
 * Where a matchup is in its life.
 *
 * Three states rather than the start/sit board's played/not-played boolean,
 * because the middle one is the whole point of this screen and that boolean
 * cannot see it: `isPlayed` there is `week < currentWeek`, which is false all
 * Sunday and true on Tuesday, so the live week renders as a preview of itself.
 */
export type MatchupPhase = "upcoming" | "live" | "final";

/**
 * One starter, as this model reads him. Structurally a subset of the start/sit
 * board's `WeekPlayer`, so that board's rows are passed in unchanged.
 */
export type LivePlayer = {
  position: string | null;
  /** This week's projection, in the league's scoring. Null when nothing projects him. */
  points: number | null;
  /** What he has actually scored. Null until a stat line lands for him. */
  actual: number | null;
  onBye: boolean;
};

/**
 * How far a weekly projection is usually wrong, as a fraction of itself.
 *
 * These are coefficients of variation, not standard errors of the projection:
 * the question is how much a player's *actual* week scatters around what he
 * was projected for, which is dominated by football and not by the projector.
 * They rise with how much of a position's scoring comes in single events — a
 * quarterback accumulates, a defense returns one kick — which is the same
 * ordering every published study of weekly fantasy variance finds.
 *
 * Deliberately coarse. The difference between a true 0.60 and this 0.62 moves
 * a win probability by a point or two; the difference between modelling
 * variance and ignoring it moves it by twenty.
 */
const SPREAD: Record<string, number> = {
  QB: 0.42,
  RB: 0.55,
  WR: 0.62,
  TE: 0.65,
  K: 0.45,
  DEF: 0.75,
  DST: 0.75,
};

/** A position nothing above names. Between a running back and a receiver. */
const DEFAULT_SPREAD = 0.6;

/**
 * The floor under a single player's standard deviation.
 *
 * Without it a player projected for 1.2 points would be treated as very nearly
 * certain to score 1.2, and a lineup of backups would come out with a tighter
 * distribution than a lineup of stars. A low projection is not a confident
 * one; it is usually a statement about playing time, which is exactly the
 * thing that swings.
 */
const MIN_SD = 1.5;

/** How far one player's week scatters around his projection. */
export function playerSd(position: string | null, projection: number): number {
  const spread = SPREAD[(position ?? "").toUpperCase()] ?? DEFAULT_SPREAD;
  return Math.max(MIN_SD, spread * Math.abs(projection));
}

/** One side of a matchup, split into what is settled and what is not. */
export type LiveSide = {
  /**
   * Points the league itself has already credited this side.
   *
   * The provider's own total where there is one, because that is the number
   * the league will settle on: it is computed under the league's real scoring
   * rules, including the defense and kicker categories this app models more
   * loosely than it models a receiver. Our own starters' stat lines are the
   * fallback, for a week or a provider that publishes no total.
   *
   * With one exception, which is not theoretical: a provider total of exactly
   * zero standing next to stat lines that say otherwise is a stale row, not a
   * shutout. Both providers publish a running total that updates on their own
   * schedule, and ESPN's schedule view in particular can still read 0-0 on a
   * Sunday evening. Trusting that zero would throw away every point already
   * scored and — worse — would tell the phase that the week had not started.
   */
  banked: number;
  /** True when `banked` is the provider's figure rather than our own sum. */
  bankedIsProviders: boolean;
  /** Σ projections of the starters who have not played yet. */
  remaining: number;
  /** `banked + remaining` — where this side finishes if everyone hits his number. */
  projected: number;
  /** Starters with a stat line already. */
  played: number;
  /** Starters still to come, byes excluded — a bye is never going to play. */
  yetToPlay: number;
  /**
   * Of those still to come, how many nothing projects. They contribute nothing
   * to `remaining` and no uncertainty, exactly as they contribute nothing to
   * the start/sit board's total, so a screen that prints `projected` has to be
   * able to say it is short this many men.
   */
  unprojected: number;
  /** Standard deviation of the points still to come. Zero once nobody is left. */
  sd: number;
};

/**
 * Split one side's starters into what it has and what it is still owed.
 *
 * A player is counted as played the moment a stat line exists for him, which
 * is the only signal either provider gives us at this grain. During his game
 * that line is partial, so for those three hours he is booked at what he has
 * so far and the side's projection understates him. The alternative — keeping
 * him in `remaining` at his full projection while also counting the points he
 * has already banked — would overstate him instead, and by more.
 */
export function liveSide(
  starters: LivePlayer[],
  scored: number | null,
): LiveSide {
  let ourTotal = 0;
  let ourLines = 0;
  let remaining = 0;
  let variance = 0;
  let played = 0;
  let yetToPlay = 0;
  let unprojected = 0;

  for (const player of starters) {
    if (player.actual !== null) {
      played += 1;
      ourTotal += player.actual;
      ourLines += 1;
      continue;
    }

    // A bye is not a man we are waiting on. Counting him among the ones still
    // to come would put "4 to play" on a side that has three players left.
    if (player.onBye) continue;

    yetToPlay += 1;

    if (player.points === null) {
      unprojected += 1;
      continue;
    }

    remaining += player.points;
    const sd = playerSd(player.position, player.points);
    variance += sd * sd;
  }

  // A zero from the provider is only believed when our own lines agree with
  // it. They do whenever the week genuinely has not started, which is the case
  // that zero is supposed to describe.
  const bankedIsProviders = scored !== null && !(scored === 0 && ourTotal > 0);
  const banked = bankedIsProviders ? scored! : ourLines === 0 ? 0 : ourTotal;

  return {
    banked,
    bankedIsProviders,
    remaining,
    projected: banked + remaining,
    played,
    yetToPlay,
    unprojected,
    sd: Math.sqrt(variance),
  };
}

/**
 * The same side once the week is over.
 *
 * A finished matchup has nothing still to play, and that has to be enforced
 * rather than assumed. A starter with no stat line is the ordinary case at the
 * end of a week — he was inactive, or his line never landed — and left alone
 * he would still be carrying his projection into `remaining`, so a week that
 * finished 131 to nothing would show as a close one and a probability of 39%
 * would sit over a team that had already lost.
 *
 * `banked` survives untouched, because by now it is the league's own final
 * score and the only figure that was ever going to settle the week. What goes
 * is every claim about the future: the projection, its uncertainty, and the
 * men it was attached to.
 */
export function settled(side: LiveSide): LiveSide {
  return {
    ...side,
    remaining: 0,
    projected: side.banked,
    yetToPlay: 0,
    unprojected: 0,
    sd: 0,
  };
}

/**
 * Φ, the standard normal CDF, by Abramowitz & Stegun 26.2.17.
 *
 * Accurate to about 7.5e-8, which is six digits more than a win probability
 * printed to the nearest percent can use. Written out rather than pulled in
 * because it is nine lines and this app has no numerics dependency.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;

  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);

  return 0.5 * (1 + sign * erf);
}

/**
 * The chance the first side outscores the second.
 *
 * Both sides' finals are sums of independent normals, so the margin between
 * them is normal too, with the two variances added — which is the one place
 * this model is knowingly optimistic. Teammates are correlated (a quarterback
 * and the receiver he throws to have the same good afternoon) and so are
 * opponents (a shootout lifts both sides), and correlation of either sign
 * widens the margin's spread. Ignoring it pulls probabilities slightly away
 * from 50% — a little too confident, never in a direction that flips a call.
 *
 * A tie is a real fantasy outcome, and with a continuous margin it has
 * probability zero, so this is strictly "outscores" and the two sides'
 * numbers sum to 1 while anything is still to be played.
 */
export function winProbability(a: LiveSide, b: LiveSide): number {
  const margin = a.projected - b.projected;
  const sd = Math.hypot(a.sd, b.sd);

  // Nobody left to play: the week is not uncertain, it is over. A dead heat
  // stays a dead heat rather than resolving to one side by rounding.
  if (sd === 0) {
    if (margin === 0) return 0.5;
    return margin > 0 ? 1 : 0;
  }

  return normalCdf(margin / sd);
}

/**
 * Where a matchup is in its life, read from the season clock first and the
 * provider's own status second.
 *
 * The clock leads because it is resolved fresh from Sleeper on every sync
 * (stage 1) while `status` is whatever the last scoreboard pull wrote, so a
 * week the clock has moved past is final even if its row still says a game was
 * under way when we looked.
 *
 * The evidence test at the end is there for ESPN, whose schedule view
 * publishes no in-progress state at all — only whether a winner has been
 * declared. It asks two questions rather than one, and the second is the one
 * that carries: a stat line exists for somebody. A provider's running total
 * can lag a whole afternoon behind the games it is adding up, and a week read
 * as "not started" while four men on the board already have scores is the
 * screen calling its own figures a lie.
 *
 * Both together are also what keeps the live week from reading as "live" on
 * the Wednesday before anybody has kicked off.
 */
export function matchupPhase({
  week,
  currentWeek,
  status,
  banked,
  playedStarters,
}: {
  week: number;
  currentWeek: number | null;
  status: string | null;
  /** Both sides' banked points together. One side's early game still counts. */
  banked: number;
  /** Starters across both sides with a stat line. The stronger of the two signals. */
  playedStarters: number;
}): MatchupPhase {
  if (currentWeek !== null && week < currentWeek) return "final";
  if (status === "postevent") return "final";
  if (currentWeek !== null && week > currentWeek) return "upcoming";
  if (status === "midevent") return "live";
  return banked > 0 || playedStarters > 0 ? "live" : "upcoming";
}


/**
 * Today's date where the NFL keeps time.
 *
 * Every kickoff this app stores is a date rather than an instant, and the date
 * a provider means is the one in the eastern United States. Asking the server
 * what day it is would end Sunday at 8pm in New York on a UTC host — which is
 * to say, in the middle of the late games — and a live screen that switches
 * itself off before the fourth quarter is worse than one that never switched
 * itself on.
 */
export function nflToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Whether this week's slate has a game on today.
 *
 * The difference between "the week is under way" and "football is being
 * played", which the phase above cannot tell apart: a Thursday night game puts
 * stat lines on the board and leaves the whole week reading as live until the
 * clock rolls past it, so a Friday and a Saturday with no football in them
 * would poll for changes that cannot happen.
 *
 * Day granularity is all `nfl_schedule.kickoff` can offer, so this is honest
 * about being a coarse gate: it knows a Saturday has no games and does not
 * know that Sunday's late window has not started.
 *
 * Answers false for a slate that was never synced. A gate that opens when we
 * know nothing would be on every day of the year.
 */
export function isGameDay(
  kickoffs: Iterable<string | null>,
  today: string = nflToday(),
): boolean {
  for (const kickoff of kickoffs) {
    if (kickoff !== null && kickoff.slice(0, 10) === today) return true;
  }
  return false;
}

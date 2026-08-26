/**
 * Where a player's picture comes from.
 *
 * Sleeper is already the app's identity spine (§3 — the player master, the ids
 * every other source is joined through), and it serves portraits off a
 * predictable CDN path rather than shipping a URL in the payload. So there is
 * nothing to fetch and nothing to store beyond the id we already hold: the
 * address is a pure function of `sleeper_id`.
 *
 * Two paths, because Sleeper keeps two kinds of thing in one player table:
 *
 * - A person is `/content/nfl/players/{sleeper_id}.jpg` — a 350x254 headshot
 *   on a white field, which is why the crop below is square and centred.
 * - A team defense is *not*. Its `sleeper_id` is the team abbreviation, and
 *   asking the player path for `PHI.jpg` answers 403, not a placeholder. The
 *   team logo at `/images/team_logos/nfl/phi.png` is the real picture of a DEF.
 *
 * Pure and transport-free so it can be unit tested and so both the sync (which
 * writes the column) and the browser (which renders it) get the same answer.
 */

const CDN = "https://sleepercdn.com";

/** Sleeper's own code for a team defense, whatever a given league calls it. */
const DEFENSE_POSITIONS = new Set(["DEF", "DST", "D/ST"]);

export function isDefense(position: string | null | undefined): boolean {
  return position ? DEFENSE_POSITIONS.has(position.toUpperCase()) : false;
}

/** A team's logo, keyed by the two- or three-letter NFL abbreviation. */
export function teamLogoUrl(nflTeam: string | null | undefined): string | null {
  const abbr = nflTeam?.trim().toLowerCase();
  return abbr ? `${CDN}/images/team_logos/nfl/${abbr}.png` : null;
}

/**
 * The portrait for one player, or null when there is no id to build one from.
 *
 * Null is a real answer and is never papered over with a placeholder image: a
 * missing picture is rendered as the fallback mark, which is honest, rather
 * than as a stock silhouette that looks like a photograph of nobody.
 */
export function playerHeadshotUrl({
  sleeperId,
  position,
  nflTeam,
}: {
  sleeperId: string | null | undefined;
  position?: string | null;
  nflTeam?: string | null;
}): string | null {
  if (isDefense(position)) {
    // The defense's own id *is* the abbreviation, so it stands in when the
    // team column is empty — a DEF is never a free agent of nowhere.
    return teamLogoUrl(nflTeam || sleeperId);
  }

  const id = sleeperId?.trim();
  return id ? `${CDN}/content/nfl/players/${id}.jpg` : null;
}

/**
 * Whether a portrait URL is a team logo rather than a photograph.
 *
 * The two differ in the one way the renderer cares about: a player's headshot
 * is cut out onto a solid white field, and a logo is a PNG with a transparent
 * one. Only the first can have its background blended away.
 */
export function isTeamLogo(src: string | null | undefined): boolean {
  return Boolean(src && src.includes("/images/team_logos/"));
}

/**
 * The mark shown where a picture cannot be. Initials rather than a silhouette,
 * for the same reason the plate is engraved rather than printed: the fallback
 * should read as the board's own lettering, not as a broken photograph.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "--";

  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

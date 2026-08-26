/**
 * The league's own sections, and which one a path is in.
 *
 * Phases 2–9 each added a screen and each gave it a back button to the league
 * page. That is fine for one screen and wrong for seven: comparing the waiver
 * wire against what the overview says a team is thin at meant three
 * navigations, two of them through a page nobody wanted to look at. The seam
 * this fills is wayfinding, not features — every one of these pages already
 * existed.
 *
 * Pure and separate from the component for the usual reason: "which tab is
 * lit" is a claim that should be testable without a router.
 */

export type LeagueSectionKey =
  | "league"
  | "values"
  | "trade"
  | "suggestions"
  | "overview"
  | "waivers"
  | "identity";

export type LeagueSection = {
  key: LeagueSectionKey;
  label: string;
  /** Appended to `/leagues/{id}`. Empty string is the league page itself. */
  segment: string;
};

/**
 * Ordered the way the league page orders its cards, which is roughly the order
 * a season is played in: see the league, price it, trade in it, then work the
 * wire. Identity is last because it is maintenance — it only earns attention
 * when the badge on it says a player is unmatched.
 */
export const LEAGUE_SECTIONS: readonly LeagueSection[] = [
  { key: "league", label: "League", segment: "" },
  { key: "values", label: "Values", segment: "values" },
  { key: "trade", label: "Trade", segment: "trade" },
  { key: "suggestions", label: "Suggestions", segment: "suggestions" },
  { key: "overview", label: "Overview", segment: "overview" },
  { key: "waivers", label: "Waivers", segment: "waivers" },
  { key: "identity", label: "Identity", segment: "identity" },
] as const;

export function sectionHref(leagueId: string, section: LeagueSection): string {
  return section.segment
    ? `/leagues/${leagueId}/${section.segment}`
    : `/leagues/${leagueId}`;
}

/**
 * Which section a pathname sits in, or `null` if it is not this league's at all.
 *
 * A player page lights the values tab rather than nothing. It is reached from
 * the values board and from the waiver wire, and it has no tab of its own — a
 * nav bar with every tab dark is a nav bar telling the user they have left the
 * app, which is not what happened.
 */
export function activeSection(
  pathname: string,
  leagueId: string,
): LeagueSectionKey | null {
  const prefix = `/leagues/${leagueId}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null;

  const rest = pathname.slice(prefix.length).replace(/^\/+|\/+$/g, "");
  if (rest === "") return "league";

  const [first] = rest.split("/");
  if (first === "players") return "values";

  const match = LEAGUE_SECTIONS.find((section) => section.segment === first);
  return match ? match.key : null;
}

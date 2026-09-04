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
  | "manage"
  | "moves"
  | "values"
  | "trade"
  | "suggestions"
  | "overview"
  | "waivers"
  | "identity";

/**
 * What kind of board this is, for navigation purposes: one whose rows a
 * provider writes, or one whose rows a person does.
 *
 * Narrower than `leagues.source` on purpose. Yahoo and ESPN differ in how the
 * rows arrive and in nothing this file cares about — both are overwritten by
 * sync stage 6, and both resolve player identity through §4's ladder — so the
 * two tabs that split on it split imported against manual, not provider
 * against provider.
 */
export type LeagueKind = "imported" | "manual";

export type LeagueSection = {
  key: LeagueSectionKey;
  label: string;
  /** Appended to `/leagues/{id}`. Empty string is the league page itself. */
  segment: string;
  /**
   * The one kind of league this section belongs to, when it is only one.
   *
   * Two sections earn this. A hand-entered league is *edited* — its rosters
   * and its move history have nowhere else to come from — and an imported one
   * is not, because stage 6 overwrites both on every sync. Identity is the
   * mirror image: §4's ladder only ever runs against a provider's ids, so on a
   * manual league that screen is a permanently empty queue.
   */
  only?: LeagueKind;
};

/**
 * Ordered the way the league page orders its cards, which is roughly the order
 * a season is played in: see the league, price it, trade in it, then work the
 * wire. Identity is last because it is maintenance — it only earns attention
 * when the badge on it says a player is unmatched.
 */
export const LEAGUE_SECTIONS: readonly LeagueSection[] = [
  { key: "league", label: "League", segment: "" },
  // Early, and not filed under maintenance, because on a hand-kept league
  // these two are where the season actually gets recorded.
  { key: "manage", label: "Manage", segment: "manage", only: "manual" },
  { key: "moves", label: "Moves", segment: "moves", only: "manual" },
  { key: "values", label: "Values", segment: "values" },
  { key: "trade", label: "Trade", segment: "trade" },
  { key: "suggestions", label: "Suggestions", segment: "suggestions" },
  { key: "overview", label: "Overview", segment: "overview" },
  { key: "waivers", label: "Waivers", segment: "waivers" },
  { key: "identity", label: "Identity", segment: "identity", only: "imported" },
] as const;

/** The tabs a league of this kind actually has. */
export function sectionsFor(source: string | null | undefined): LeagueSection[] {
  // Anything that is not explicitly manual is imported — including a row from
  // before `source` existed, every one of which was a Yahoo league.
  const kind: LeagueKind = source === "manual" ? "manual" : "imported";
  return LEAGUE_SECTIONS.filter(
    (section) => section.only === undefined || section.only === kind,
  );
}

/**
 * The same section on a different league, or that league's front page.
 *
 * What makes switching leagues worth a control at all is landing in the same
 * place: comparing two boards' waiver wires means seeing the second one's
 * waiver wire, not its overview. So the current section is carried across —
 * except where the target does not have it, which is exactly the imported /
 * manual split. Jumping from an imported league's identity queue to a
 * hand-kept league has nowhere to land, and the league page is the honest
 * answer rather than a 404 or a silently different tab.
 */
export function switchHref(
  targetLeagueId: string,
  targetSource: string | null | undefined,
  section: LeagueSectionKey | null,
): string {
  const base = `/leagues/${targetLeagueId}`;
  if (section === null || section === "league") return base;

  const match = sectionsFor(targetSource).find(
    (entry) => entry.key === section,
  );

  return match ? sectionHref(targetLeagueId, match) : base;
}

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

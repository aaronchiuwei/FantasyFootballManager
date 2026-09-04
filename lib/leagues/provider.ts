/**
 * What to call the service a league came from.
 *
 * `leagues.source` is the app's word for it; this is the user's. It exists
 * because the two diverge in one place that matters: provider player ids are
 * all stored under the `yahoo` source key, ESPN's included, because the ESPN
 * import reused the crosswalk namespace rather than forking it. That is a
 * reasonable storage decision and a terrible label — an ESPN league's identity
 * screen was printing "yahoo #16002" for an ESPN id.
 *
 * So the screen asks the league, not the row.
 */

export type ProviderLabels = {
  /** Title case, for prose: "Reconnect Yahoo". */
  name: string;
  /** Lower case, for the id line: "espn #16002". */
  idPrefix: string;
};

const LABELS: Record<string, ProviderLabels> = {
  espn: { name: "ESPN", idPrefix: "espn" },
  yahoo: { name: "Yahoo", idPrefix: "yahoo" },
  manual: { name: "Entered by hand", idPrefix: "manual" },
};

export function providerLabels(source: string | null | undefined): ProviderLabels {
  return LABELS[source ?? ""] ?? LABELS.yahoo;
}

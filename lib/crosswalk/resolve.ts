/**
 * The resolution ladder of §4, as a pure function of (target, candidates).
 *
 * Steps 1–3 of the plan's ladder — manual override, DynastyProcess, Sleeper's
 * own `yahoo_id` — are *persisted* lookups: they are seeded into
 * `player_crosswalk` / `player_id_overrides` once and consulted by key, so they
 * never reach this module. What is left here is the part that has to be
 * recomputed from names: steps 4–6, plus the team-defense special case.
 *
 * The one rule that outranks coverage: an ambiguous match is not a match.
 * Two candidates that fit equally well and cannot be separated by a tiebreak
 * fall through to `unmatched_players`, because silently picking the wrong
 * Kenneth Walker corrupts every trade verdict that touches him.
 */
import { normalizeName } from "../sources/name-normalize";
import { trigramSimilarity } from "./similarity";

/** §4 step 6. Same number as the `pg_trgm` threshold the plan specifies. */
export const FUZZY_THRESHOLD = 0.88;

export type MatchMethod =
  | "override"
  | "dynastyprocess"
  | "sleeper_yahoo_id"
  | "team_defense"
  | "name_position_team"
  | "name_position"
  | "fuzzy";

export type CrosswalkCandidate = {
  playerId: number;
  /** Sleeper's `search_full_name` — already normalized (§4 step 4). */
  searchName: string;
  fullName: string;
  position: string | null;
  nflTeam: string | null;
  birthDate?: string | null;
};

export type ResolveTarget = {
  sourceId: string;
  name: string;
  position: string | null;
  nflTeam: string | null;
  /** Yahoo models a defense as a team entity, not a player (§4). */
  isDefense?: boolean;
  birthDate?: string | null;
};

/**
 * What an unmatched row carries so the admin UI can resolve it without going
 * back to Yahoo. Lives here rather than in the server-only store so a client
 * component can name the shape.
 */
export type UnmatchedPayload = {
  playerKey: string;
  name: string;
  position: string | null;
  nflTeam: string | null;
  isDefense: boolean;
  status: string | null;
  /** Null for a free agent — nothing to write to `rosters` when resolved. */
  teamKey: string | null;
  slot: string | null;
  isStarter: boolean;
};

export type Resolution = {
  playerId: number;
  method: MatchMethod;
  confidence: number;
};

/**
 * Franchise moves and the several spellings the sources disagree on. Anything
 * not listed passes through unchanged — Yahoo and Sleeper agree on most.
 */
const TEAM_ALIASES: Record<string, string> = {
  JAC: "JAX",
  WSH: "WAS",
  WFT: "WAS",
  LA: "LAR",
  STL: "LAR",
  SD: "LAC",
  OAK: "LV",
  ARZ: "ARI",
  BLT: "BAL",
  CLV: "CLE",
  HST: "HOU",
  NOR: "NO",
  NWE: "NE",
  GNB: "GB",
  KAN: "KC",
  SFO: "SF",
  TAM: "TB",
};

const POSITION_ALIASES: Record<string, string> = {
  DST: "DEF",
  "D/ST": "DEF",
  DEFENSE: "DEF",
  PK: "K",
  FB: "RB",
};

export function normalizeTeam(team: string | null | undefined): string | null {
  if (!team) return null;
  const upper = team.trim().toUpperCase();
  if (upper === "" || upper === "FA" || upper === "NA") return null;
  return TEAM_ALIASES[upper] ?? upper;
}

export function normalizePosition(
  position: string | null | undefined,
): string | null {
  if (!position) return null;
  const upper = position.trim().toUpperCase();
  if (upper === "") return null;
  // Yahoo separates multi-position eligibility with commas ("RB,WR"); the
  // first entry is the primary one. Slash forms are position names ("D/ST"),
  // never lists, so they are aliased whole rather than split.
  const primary = (POSITION_ALIASES[upper] ?? upper).split(",")[0].trim();
  return POSITION_ALIASES[primary] ?? primary;
}

function nameKey(name: string, position: string, team?: string | null) {
  return team ? `${name}|${position}|${team}` : `${name}|${position}`;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * Narrows a list of equally-good candidates to one, or gives up. Birth date is
 * the discriminator when a source supplies it (FantasyCalc's `maybeBirthday`);
 * NFL team is the fallback. Sleeper's master carries no draft year, so the
 * plan's draft-year arm of this tiebreak has nothing to compare against.
 */
function pickOne(
  candidates: CrosswalkCandidate[] | undefined,
  target: ResolveTarget,
): CrosswalkCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (target.birthDate) {
    const byBirth = candidates.filter((c) => c.birthDate === target.birthDate);
    if (byBirth.length === 1) return byBirth[0];
  }

  const team = normalizeTeam(target.nflTeam);
  if (team) {
    const byTeam = candidates.filter((c) => normalizeTeam(c.nflTeam) === team);
    if (byTeam.length === 1) return byTeam[0];
  }

  return null;
}

/**
 * A candidate is indexed under both Sleeper's `search_full_name` and our own
 * normalization of its full name. The two usually agree, but they part company
 * on suffixes — Sleeper keeps the `iii` in "kennethwalkeriii" while §4 step 4
 * drops it — and a name key that only half-matches is the same as no key.
 */
function candidateKeys(candidate: CrosswalkCandidate): string[] {
  const keys = new Set<string>();
  if (candidate.searchName) keys.add(candidate.searchName);
  const normalized = normalizeName(candidate.fullName ?? "");
  if (normalized) keys.add(normalized);
  return [...keys];
}

type Indexed = { candidate: CrosswalkCandidate; keys: string[] };

function bestSimilarity(name: string, entry: Indexed): number {
  let best = 0;
  for (const key of entry.keys) {
    best = Math.max(best, trigramSimilarity(name, key));
  }
  return best;
}

export class CandidateIndex {
  readonly #byNamePositionTeam = new Map<string, CrosswalkCandidate[]>();
  readonly #byNamePosition = new Map<string, CrosswalkCandidate[]>();
  readonly #byPosition = new Map<string, Indexed[]>();
  readonly #defenses = new Map<string, CrosswalkCandidate>();
  readonly #indexed: Indexed[] = [];

  constructor(readonly candidates: CrosswalkCandidate[]) {
    for (const candidate of candidates) {
      const position = normalizePosition(candidate.position);
      const team = normalizeTeam(candidate.nflTeam);
      const keys = candidateKeys(candidate);
      this.#indexed.push({ candidate, keys });

      if (position === "DEF") {
        // Sleeper keys a defense by its team abbreviation, which is the only
        // handle Yahoo gives us for one too.
        const key = team ?? normalizeTeam(candidate.searchName);
        if (key && !this.#defenses.has(key)) this.#defenses.set(key, candidate);
        continue;
      }

      if (!position || keys.length === 0) continue;

      push(this.#byPosition, position, { candidate, keys });

      for (const key of keys) {
        push(this.#byNamePosition, nameKey(key, position), candidate);
        if (team) {
          push(this.#byNamePositionTeam, nameKey(key, position, team), candidate);
        }
      }
    }
  }

  /** First hit wins, in ladder order. `null` means "write it to unmatched". */
  match(target: ResolveTarget): Resolution | null {
    const position = normalizePosition(target.position);
    const team = normalizeTeam(target.nflTeam);

    if (target.isDefense || position === "DEF") {
      const defense = team ? this.#defenses.get(team) : undefined;
      return defense
        ? { playerId: defense.playerId, method: "team_defense", confidence: 1 }
        : null;
    }

    const name = normalizeName(target.name);
    if (!name || !position) return null;

    if (team) {
      const exact = pickOne(
        this.#byNamePositionTeam.get(nameKey(name, position, team)),
        target,
      );
      if (exact) {
        return {
          playerId: exact.playerId,
          method: "name_position_team",
          confidence: 0.95,
        };
      }
    }

    // Team ignored: catches in-season trades and roster churn between the
    // Sleeper master's refresh and Yahoo's view of the world (§4 step 5).
    const anyTeam = pickOne(this.#byNamePosition.get(nameKey(name, position)), target);
    if (anyTeam) {
      return {
        playerId: anyTeam.playerId,
        method: "name_position",
        confidence: 0.9,
      };
    }

    return this.#fuzzy(name, position, target);
  }

  /** Position-gated trigram search — never compares a WR against a QB (§4 step 6). */
  #fuzzy(
    name: string,
    position: string,
    target: ResolveTarget,
  ): Resolution | null {
    let best = 0;
    let tied: CrosswalkCandidate[] = [];

    for (const entry of this.#byPosition.get(position) ?? []) {
      const score = bestSimilarity(name, entry);
      if (score < FUZZY_THRESHOLD) continue;

      if (score > best + 1e-9) {
        best = score;
        tied = [entry.candidate];
      } else if (Math.abs(score - best) <= 1e-9) {
        tied.push(entry.candidate);
      }
    }

    const picked = pickOne(tied, target);
    if (!picked) return null;

    return {
      playerId: picked.playerId,
      method: "fuzzy",
      confidence: Math.round(best * 100) / 100,
    };
  }

  /**
   * Ranked "did you mean" list for the admin resolution UI (§4). Unlike
   * `match`, this is deliberately permissive — a human is about to look at it,
   * so a same-position, same-team near-miss should surface even at a similarity
   * the automatic ladder would refuse.
   */
  suggest(target: ResolveTarget, limit = 5): CrosswalkCandidate[] {
    const name = normalizeName(target.name);
    const position = normalizePosition(target.position);
    const team = normalizeTeam(target.nflTeam);

    return this.#indexed
      .map((entry) => {
        const { candidate } = entry;
        const samePosition = normalizePosition(candidate.position) === position;
        const sameTeam = team !== null && normalizeTeam(candidate.nflTeam) === team;

        return {
          candidate,
          score:
            bestSimilarity(name, entry) +
            (samePosition ? 0.15 : 0) +
            (sameTeam ? 0.1 : 0),
        };
      })
      .filter((entry) => entry.score > 0.2)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.candidate);
  }
}

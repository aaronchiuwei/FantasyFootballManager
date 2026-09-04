/**
 * What a hand-entered league looks like on the way in.
 *
 * Pure, and separate from the writes for the same reason the Yahoo parsers are
 * separate from the Yahoo transport: the interesting part is the reading, and
 * reading is testable without a database. Everything here turns a string a
 * person typed into the shapes the rest of the app already speaks — `RosterSlot`
 * exactly as `parseLeague` builds it, so nothing downstream can tell where a
 * league came from.
 */
import { z } from "zod";

import type { RosterSlot } from "@/lib/sources/yahoo-parse";
import { eligiblePositions } from "@/lib/values/vor";

/**
 * The slots the picker offers, spelled the way Yahoo spells them.
 *
 * Not an enum, and not enforced: `parseLineup` accepts any slash form
 * `eligiblePositions` can read, because a league with a `Q/W/R/T/K` or a `W/T`
 * is a real league and refusing it would be inventing a rule Yahoo does not
 * have. This list is what the UI suggests, not what it allows.
 */
export const COMMON_SLOTS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "W/R/T",
  "Q/W/R/T",
  "K",
  "DEF",
] as const;

/** Slots that hold players without starting them. Yahoo's own two spellings. */
const RESERVE_SLOTS = new Set(["BN", "IR"]);

const SLOT_ALIASES: Record<string, string> = {
  DST: "DEF",
  "D/ST": "DEF",
  DEFENSE: "DEF",
  PK: "K",
  BENCH: "BN",
  B: "BN",
  FLEX: "W/R/T",
  WRT: "W/R/T",
  "RB/WR/TE": "W/R/T",
  SUPERFLEX: "Q/W/R/T",
  SFLEX: "Q/W/R/T",
  SF: "Q/W/R/T",
  OP: "Q/W/R/T",
  "QB/RB/WR/TE": "Q/W/R/T",
  IL: "IR",
  "IR+": "IR",
};

/**
 * One entry of a typed lineup, canonicalised — or `null` when it names nothing
 * this app can fill a seat with.
 *
 * A slot we cannot read is dropped rather than guessed at, and the caller is
 * handed the raw text back so the form can say which word it did not know.
 * Guessing here would be expensive in a way that is invisible later: an
 * unreadable slot silently treated as a flex changes every replacement rank in
 * the league, and nothing on any screen would say so.
 */
export function normalizeSlotName(raw: string): string | null {
  const upper = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (upper === "") return null;

  const aliased = SLOT_ALIASES[upper] ?? upper;
  if (RESERVE_SLOTS.has(aliased)) return aliased;
  if (aliased === "K" || aliased === "DEF") return aliased;

  return eligiblePositions(aliased).length > 0 ? aliased : null;
}

/** True for a slot that puts points on the board, as opposed to holding depth. */
export function isStartingSlot(slot: string): boolean {
  return !RESERVE_SLOTS.has(slot);
}

/**
 * Yahoo's coarse grouping, which `roster_slots` carries and nothing in this app
 * reads. Filled in anyway so a manual league's JSON is the same shape as an
 * imported one — a column that means two different things depending on
 * provenance is a trap for whoever reads it next.
 */
function positionTypeFor(slot: string): string | null {
  if (RESERVE_SLOTS.has(slot)) return null;
  if (slot === "DEF") return "DT";
  if (slot === "K") return "K";
  return "O";
}

const COUNT_PREFIX = /^(\d+)\s*[x×*]\s*(.+)$/i;
const COUNT_SUFFIX = /^(.+?)\s*[x×*]\s*(\d+)$/i;

/**
 * A typed lineup as roster slots.
 *
 * Accepts the three ways people actually write one: repetition (`RB, RB`), a
 * leading count (`2×RB`), and a trailing one (`RB x2`). Order is preserved and
 * repeats are merged, so `QB, RB, WR, RB` comes back as one RB slot with a
 * count of two, sitting where the first RB was.
 */
export function parseLineup(text: string): {
  slots: RosterSlot[];
  unknown: string[];
} {
  const slots: RosterSlot[] = [];
  const byPosition = new Map<string, RosterSlot>();
  const unknown: string[] = [];

  for (const rawEntry of text.split(/[,\n;]+/)) {
    const entry = rawEntry.trim();
    if (entry === "") continue;

    let count = 1;
    let name = entry;

    const prefix = COUNT_PREFIX.exec(entry);
    const suffix = prefix ? null : COUNT_SUFFIX.exec(entry);
    if (prefix) {
      count = Number(prefix[1]);
      name = prefix[2];
    } else if (suffix) {
      name = suffix[1];
      count = Number(suffix[2]);
    }

    const slot = normalizeSlotName(name);
    if (!slot) {
      unknown.push(entry);
      continue;
    }
    // `0×WR` is someone deleting a slot mid-edit, not a slot of size zero.
    if (!Number.isFinite(count) || count < 1) continue;

    const existing = byPosition.get(slot);
    if (existing) {
      existing.count += count;
      continue;
    }

    const created: RosterSlot = {
      position: slot,
      positionType: positionTypeFor(slot),
      count,
      isStarting: isStartingSlot(slot),
    };
    byPosition.set(slot, created);
    slots.push(created);
  }

  return { slots, unknown };
}

/**
 * Roster slots back as text, for an edit form to start from. Round-trips
 * through `parseLineup` — that is what the test asserts and what makes the
 * settings screen safe to open and close without changing anything.
 */
export function formatLineup(slots: RosterSlot[]): string {
  return slots
    .filter((slot) => slot.count > 0)
    .map((slot) => (slot.count > 1 ? `${slot.count}×${slot.position}` : slot.position))
    .join(", ");
}

/**
 * How many quarterbacks the league starts, in the only two flavours the value
 * engine and the FantasyCalc board know: 1, or 2 for superflex.
 *
 * Derived rather than asked for. It is the single setting most likely to be
 * answered wrong on a form — plenty of managers play superflex without ever
 * calling it that — and the lineup already contains the answer. A slot that
 * accepts a QB and something else is a superflex; two hard QB slots is the
 * same thing said differently.
 */
export function numQbsFor(slots: RosterSlot[]): number {
  let hard = 0;
  let superflex = false;

  for (const slot of slots) {
    if (!slot.isStarting || slot.count <= 0) continue;
    const eligible = eligiblePositions(slot.position);
    if (!eligible.includes("QB")) continue;

    if (eligible.length === 1) hard += slot.count;
    else superflex = true;
  }

  return superflex || hard >= 2 ? 2 : 1;
}

/**
 * Team names, one per line.
 *
 * Blank lines are ignored and duplicates are refused rather than silently
 * de-duplicated: two teams with one name is a typo every time, and the roster
 * screen picks a team by name.
 */
export function parseTeamNames(text: string): {
  names: string[];
  duplicate: string | null;
} {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const line of text.split("\n")) {
    const name = line.trim().replace(/\s+/g, " ");
    if (name === "") continue;

    const key = name.toLowerCase();
    if (seen.has(key)) return { names, duplicate: name };

    seen.add(key);
    names.push(name);
  }

  return { names, duplicate: null };
}

// ---------------------------------------------------------------------------
// the form itself
// ---------------------------------------------------------------------------

/** A season the NFL has actually played, give or take next year's draft. */
const SEASON_MIN = 2000;
const SEASON_MAX = 2100;

/**
 * Scoring presets, and the PPR each one means.
 *
 * §1.2 says scoring is read, never hardcoded — this is the reading, moved to
 * the only place it can happen when there is no API to read it from. The
 * number is still what reaches `leagues.ppr` and still what parameterises the
 * FantasyCalc board; the preset is a label over it, and `custom` lets a league
 * that scores 0.75 say so.
 */
export const SCORING_PRESETS = [
  { key: "std", label: "Standard", ppr: 0 },
  { key: "half", label: "Half PPR", ppr: 0.5 },
  { key: "ppr", label: "Full PPR", ppr: 1 },
  { key: "custom", label: "Custom", ppr: null },
] as const;

export type ScoringPresetKey = (typeof SCORING_PRESETS)[number]["key"];

const trimmed = z.string().trim();

/**
 * A number typed into a form. Empty means "not set", which for every optional
 * setting here is a real answer and not a validation failure — a league in the
 * off-season has no current week, and inventing one would put a week badge on
 * the board that nothing supports.
 */
const blankToNull = (value: unknown) =>
  value === "" || value === undefined ? null : value;

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    blankToNull,
    z.coerce.number().int().min(min).max(max).nullable(),
  );

/** A checkbox as FormData sends it: the value when ticked, absent when not. */
const checkbox = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean(),
);

/**
 * The settings a league has whether or not it has any teams yet.
 *
 * Split out from the creation form because the two are used at different
 * moments and only one of them is ever right. Creation needs team names and
 * cannot proceed without them; the manage screen edits settings on a league
 * that already has teams, and asking for them again there would make the
 * roster the settings form's business.
 */
const leagueFields = {
  name: trimmed.min(1, "Give the league a name.").max(120),
  season: z.coerce
    .number()
    .int()
    .min(SEASON_MIN, `Season must be ${SEASON_MIN} or later.`)
    .max(SEASON_MAX),
  ppr: z.coerce
    .number()
    .min(0, "PPR cannot be negative.")
    .max(3, "That is not a PPR setting."),
  lineup: trimmed.min(1, "Describe the starting lineup."),
  isDynasty: checkbox,
  scoringLabel: z.preprocess(blankToNull, trimmed.max(40).nullable()),
  // No `currentWeek`. It is not a preference, it is a fact about today, and
  // sync stage 1 already reads the live NFL week from Sleeper on every run.
  // Asking for it would mean a number that is right for a week and then wrong
  // for the rest of the season, with nothing to correct it.
  startWeek: optionalInt(1, 25),
  endWeek: optionalInt(1, 25),
};

type WeekBounds = { startWeek: number | null; endWeek: number | null };

const weeksInOrder = (value: WeekBounds) =>
  value.startWeek === null ||
  value.endWeek === null ||
  value.startWeek <= value.endWeek;

const WEEK_ORDER_MESSAGE = {
  message: "The last week cannot come before the first.",
  path: ["endWeek"],
};

export const manualSettingsSchema = z
  .object(leagueFields)
  .refine(weeksInOrder, WEEK_ORDER_MESSAGE);

export const manualLeagueSchema = z
  .object({
    ...leagueFields,
    teams: trimmed.min(1, "Name at least two teams."),
  })
  .refine(weeksInOrder, WEEK_ORDER_MESSAGE);

export type ManualLeagueInput = z.input<typeof manualLeagueSchema>;

/** The settings half of a league row, as a validated form implies them. */
export type ManualLeagueSettings = {
  name: string;
  season: number;
  ppr: number;
  numQbs: number;
  scoringType: string | null;
  rosterSlots: RosterSlot[];
  isDynasty: boolean;
  startWeek: number | null;
  endWeek: number | null;
};

/** Those settings, plus the teams a brand-new league is opened with. */
export type ManualLeaguePlan = ManualLeagueSettings & {
  numTeams: number;
  teamNames: string[];
};

export type Planned<T> = { ok: true; plan: T } | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form.";
}

/**
 * Everything both forms share: the settings, with the lineup read.
 *
 * Returns one message rather than a field map on purpose. Every one of these
 * is a sentence the user can act on without being told which input it came
 * from, and the alternative is a form component that has to know the shape of
 * an error object to render it.
 */
export function planManualSettings(raw: unknown): Planned<ManualLeagueSettings> {
  const parsed = manualSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const form = parsed.data;
  const { slots, unknown } = parseLineup(form.lineup);

  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Could not read ${
        unknown.length === 1 ? "this lineup slot" : "these lineup slots"
      }: ${unknown.join(", ")}.`,
    };
  }
  if (!slots.some((slot) => slot.isStarting)) {
    return { ok: false, error: "The lineup has no starting slots." };
  }

  return {
    ok: true,
    plan: {
      name: form.name,
      season: form.season,
      ppr: form.ppr,
      numQbs: numQbsFor(slots),
      scoringType: form.scoringLabel,
      rosterSlots: slots,
      isDynasty: form.isDynasty,
      startWeek: form.startWeek,
      endWeek: form.endWeek,
    },
  };
}

/** The creation form: settings, plus the teams that will play in the league. */
export function planManualLeague(raw: unknown): Planned<ManualLeaguePlan> {
  const settings = planManualSettings(raw);
  if (!settings.ok) return settings;

  const parsed = manualLeagueSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const { names, duplicate } = parseTeamNames(parsed.data.teams);
  if (duplicate !== null) {
    return { ok: false, error: `Two teams are both called \u201C${duplicate}\u201D.` };
  }
  if (names.length < 2) {
    return { ok: false, error: "A league needs at least two teams." };
  }
  if (names.length > 32) {
    return { ok: false, error: "That is more teams than any league has." };
  }

  return {
    ok: true,
    plan: { ...settings.plan, numTeams: names.length, teamNames: names },
  };
}

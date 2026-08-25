/**
 * The shape of a sync run, as a pure module.
 *
 * No `server-only` and no transport: the pipeline writes these structures and
 * the progress UI reads them straight off the Realtime payload, so both halves
 * have to agree on them. Everything here is data and arithmetic over data.
 */

/** The eight stages of §9, in the order they run. */
export const STAGE_IDS = [
  "state",
  "players",
  "values",
  "projections",
  "stats",
  "yahoo",
  "resolve",
  "compute",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export function isStageId(value: string): value is StageId {
  return (STAGE_IDS as readonly string[]).includes(value);
}

export type StageMeta = {
  id: StageId;
  label: string;
  /** One line, present tense — what the checklist says while it runs. */
  description: string;
};

export const STAGES: StageMeta[] = [
  {
    id: "state",
    label: "Season clock",
    description: "Reading the NFL week from Sleeper",
  },
  {
    id: "players",
    label: "Player master",
    description: "Refreshing Sleeper's player list",
  },
  {
    id: "values",
    label: "Trade market",
    description: "Pulling FantasyCalc prices for your settings",
  },
  {
    id: "projections",
    label: "Projections",
    description: "Pulling season and week-by-week projections",
  },
  {
    id: "stats",
    label: "Stats",
    description: "Pulling actuals, and last season for context",
  },
  {
    id: "yahoo",
    label: "Yahoo league",
    description: "Standings, rosters, matchups and free agents",
  },
  {
    id: "resolve",
    label: "Player identity",
    description: "Matching Yahoo players to the master list",
  },
  {
    id: "compute",
    label: "Values, needs and trades",
    description:
      "Pricing every player, reading every roster's needs, then searching every pair for a win-win",
  },
];

export const STAGE_LABELS: Record<StageId, string> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, stage.label]),
) as Record<StageId, string>;

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export type StageState = {
  id: StageId;
  status: StageStatus;
  /** The one-line result the stage reports when it lands. */
  detail: string | null;
  /** Non-fatal problems: a degraded source, an invariant that came out ugly. */
  warnings: string[];
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type RunStatus = "running" | "succeeded" | "failed";

/**
 * What the stages hand each other. Written by stage 1 and read by the rest,
 * so a stage never has to re-derive the season clock or re-read settings that
 * an earlier stage already resolved.
 */
export type SyncContext = {
  leagueKey: string;
  season: number;
  /** Sleeper's live season, which is not always the league's. */
  liveSeason: number;
  /**
   * The season whose actuals stand in for this one's before kickoff (§12).
   * Sleeper reports it directly; `season - 1` is the fallback and the meaning.
   */
  priorSeason: number;
  seasonType: string;
  isRegularSeason: boolean;
  currentWeek: number | null;
  startWeek: number | null;
  endWeek: number | null;
  weeksRemaining: number;
  numTeams: number;
  numQbs: number;
  ppr: number;
  /** Set when Yahoo turned the refresh token down — the UI prompts a re-link. */
  needsReauth?: boolean;
};

export type SyncRun = {
  id: string;
  leagueId: string;
  status: RunStatus;
  stages: StageState[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
};

/**
 * A `sync_runs` row as it arrives from PostgREST or a Realtime payload. Typed
 * here rather than imported from the generated database types so the browser
 * half of the progress UI can read a payload without pulling in server types.
 */
export type SyncRunRecord = {
  id: string;
  user_id: string;
  league_id: string;
  status: string;
  stages: unknown;
  context: unknown;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  updated_at: string;
};

export function toSyncRun(row: SyncRunRecord): SyncRun {
  return {
    id: row.id,
    leagueId: row.league_id,
    status: row.status as RunStatus,
    stages: row.stages as StageState[],
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export function contextOf(row: SyncRunRecord): SyncContext {
  return (row.context ?? {}) as SyncContext;
}

export function initialStages(): StageState[] {
  return STAGE_IDS.map((id) => ({
    id,
    status: "pending" as const,
    detail: null,
    warnings: [],
    startedAt: null,
    finishedAt: null,
    error: null,
  }));
}

export function stageIndex(id: StageId): number {
  return STAGE_IDS.indexOf(id);
}

/** The stage that runs after `id`, or null when `id` is the last one. */
export function nextStage(id: StageId): StageId | null {
  return STAGE_IDS[stageIndex(id) + 1] ?? null;
}

export function patchStage(
  stages: StageState[],
  id: StageId,
  patch: Partial<StageState>,
): StageState[] {
  return stages.map((stage) =>
    stage.id === id ? { ...stage, ...patch } : stage,
  );
}

/**
 * The first stage a retry should re-run: whatever failed, or — if the run died
 * without recording a failure — the first one that never finished. Everything
 * before it is committed and is not paid for twice (§9).
 */
export function resumeFrom(stages: StageState[]): StageId | null {
  const failed = stages.find((stage) => stage.status === "failed");
  if (failed) return failed.id;

  const unfinished = stages.find(
    (stage) => stage.status === "pending" || stage.status === "running",
  );
  return unfinished?.id ?? null;
}

/**
 * Reopens `from` and everything after it. A resumed stage may legitimately
 * produce a different answer than the dead attempt did, so its old detail and
 * warnings go with it rather than lingering next to a fresh result.
 */
export function reopenFrom(stages: StageState[], from: StageId): StageState[] {
  const start = stageIndex(from);

  return stages.map((stage, index) =>
    index < start
      ? stage
      : {
          ...stage,
          status: "pending" as const,
          detail: null,
          warnings: [],
          startedAt: null,
          finishedAt: null,
          error: null,
        },
  );
}

/** Fraction of the pipeline that has landed, for the progress ring. */
export function progressOf(stages: StageState[]): number {
  const settled = stages.filter(
    (stage) => stage.status === "done" || stage.status === "skipped",
  ).length;

  return stages.length === 0 ? 0 : settled / stages.length;
}

/** How long a run may go quiet before the UI calls it stalled rather than slow. */
export const STALL_AFTER_MS = 90_000;

export function isStalled(run: SyncRun, now = Date.now()): boolean {
  return (
    run.status === "running" && now - Date.parse(run.updatedAt) > STALL_AFTER_MS
  );
}

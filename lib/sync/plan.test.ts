import { describe, expect, it } from "vitest";

import {
  afterLeague,
  initialStages,
  isStalled,
  nextInQueue,
  nextStage,
  patchStage,
  progressOf,
  reopenFrom,
  resumeFrom,
  STAGES,
  STAGE_IDS,
  STALL_AFTER_MS,
  toSyncRun,
  type StageState,
  type SyncBatch,
  type SyncRun,
} from "./plan";

function run(stages: StageState[], overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "run-1",
    leagueId: "league-1",
    status: "running",
    stages,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("the stage plan", () => {
  it("describes every stage of §9 exactly once, in order", () => {
    expect(STAGE_IDS).toHaveLength(8);
    expect(STAGES.map((stage) => stage.id)).toEqual([...STAGE_IDS]);
    expect(new Set(STAGE_IDS).size).toBe(STAGE_IDS.length);
  });

  it("chains each stage to the next and stops at the last", () => {
    expect(nextStage("state")).toBe("players");
    expect(nextStage("resolve")).toBe("compute");
    expect(nextStage("compute")).toBeNull();
  });

  it("starts every stage pending", () => {
    expect(initialStages().every((stage) => stage.status === "pending")).toBe(true);
  });
});

describe("progress", () => {
  it("counts skipped stages as landed — a skip is a result, not a gap", () => {
    let stages = initialStages();
    stages = patchStage(stages, "state", { status: "done" });
    stages = patchStage(stages, "players", { status: "skipped" });

    expect(progressOf(stages)).toBeCloseTo(0.25);
  });

  it("is zero on a fresh run and one on a finished one", () => {
    expect(progressOf(initialStages())).toBe(0);
    expect(
      progressOf(initialStages().map((stage) => ({ ...stage, status: "done" }))),
    ).toBe(1);
  });
});

describe("resuming a failed run", () => {
  it("resumes at the stage that failed", () => {
    let stages = initialStages();
    for (const id of ["state", "players", "values"] as const) {
      stages = patchStage(stages, id, { status: "done" });
    }
    stages = patchStage(stages, "projections", { status: "failed" });

    expect(resumeFrom(stages)).toBe("projections");
  });

  it("resumes at the first unfinished stage when nothing recorded a failure", () => {
    // The shape a killed invocation leaves behind: still "running", no error.
    let stages = initialStages();
    stages = patchStage(stages, "state", { status: "done" });
    stages = patchStage(stages, "players", { status: "running" });

    expect(resumeFrom(stages)).toBe("players");
  });

  it("has nothing to resume once every stage has landed", () => {
    const stages = initialStages().map((stage) => ({
      ...stage,
      status: "done" as const,
    }));

    expect(resumeFrom(stages)).toBeNull();
  });

  it("keeps committed stages and clears the resumed ones", () => {
    let stages = initialStages();
    stages = patchStage(stages, "state", {
      status: "done",
      detail: "Week 3 of 2026",
    });
    stages = patchStage(stages, "players", {
      status: "failed",
      detail: "half a result",
      warnings: ["stale"],
      error: "boom",
    });

    const reopened = reopenFrom(stages, "players");
    const [state, players, values] = reopened;

    expect(state.status).toBe("done");
    expect(state.detail).toBe("Week 3 of 2026");
    expect(players).toMatchObject({
      status: "pending",
      detail: null,
      error: null,
      warnings: [],
    });
    expect(values.status).toBe("pending");
  });
});

describe("stall detection", () => {
  const now = Date.now();

  it("calls a quiet running run stalled", () => {
    const quiet = run(initialStages(), {
      updatedAt: new Date(now - STALL_AFTER_MS - 1_000).toISOString(),
    });

    expect(isStalled(quiet, now)).toBe(true);
  });

  it("leaves a run that is merely slow alone", () => {
    const busy = run(initialStages(), {
      updatedAt: new Date(now - 10_000).toISOString(),
    });

    expect(isStalled(busy, now)).toBe(false);
  });

  it("never calls a finished run stalled", () => {
    const done = run(initialStages(), {
      status: "succeeded",
      updatedAt: new Date(now - 86_400_000).toISOString(),
    });

    expect(isStalled(done, now)).toBe(false);
  });
});

describe("toSyncRun", () => {
  it("maps a row the browser receives over Realtime", () => {
    const mapped = toSyncRun({
      id: "run-1",
      user_id: "user-1",
      league_id: "league-1",
      status: "succeeded",
      stages: initialStages(),
      context: { season: 2026 },
      error: null,
      started_at: "2026-08-25T00:00:00.000Z",
      finished_at: "2026-08-25T00:00:40.000Z",
      updated_at: "2026-08-25T00:00:40.000Z",
    });

    expect(mapped.leagueId).toBe("league-1");
    expect(mapped.status).toBe("succeeded");
    expect(mapped.stages).toHaveLength(8);
  });
});

describe("nextInQueue", () => {
  const batch: SyncBatch = { queue: ["a", "b", "c"], done: 0, total: 3 };

  it("takes the head and hands the rest to it", () => {
    expect(nextInQueue(batch)).toEqual({
      leagueId: "a",
      carry: { queue: ["b", "c"], done: 0, total: 3 },
    });
  });

  it("leaves the count alone — taking a league is not finishing one", () => {
    expect(nextInQueue(batch)?.carry.done).toBe(0);
  });

  it("has nothing to hand out once the queue is empty", () => {
    expect(nextInQueue({ queue: [], done: 3, total: 3 })).toBeNull();
  });

  it("does not mutate the batch it was given", () => {
    nextInQueue(batch);
    expect(batch.queue).toEqual(["a", "b", "c"]);
  });
});

describe("afterLeague", () => {
  it("counts one league as dealt with", () => {
    expect(afterLeague({ queue: ["b"], done: 0, total: 2 })).toEqual({
      queue: ["b"],
      done: 1,
      total: 2,
    });
  });

  it("never counts past the total", () => {
    expect(afterLeague({ queue: [], done: 3, total: 3 }).done).toBe(3);
  });

  it("walks a whole batch to exactly total, one league at a time", () => {
    let batch: SyncBatch = { queue: ["a", "b", "c"], done: 0, total: 3 };
    const labels: string[] = [];

    for (let step = nextInQueue(batch); step; step = nextInQueue(batch)) {
      // What the button prints while that league is the one being synced.
      labels.push(`${step.carry.done + 1} of ${step.carry.total}`);
      batch = afterLeague(step.carry);
    }

    expect(labels).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
    expect(batch.done).toBe(3);
  });
});

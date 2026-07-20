import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createCronCalculator } from "../../../src/scheduler/cron.js";
import { createJob } from "../../../src/storage/repositories/job-repository.js";
import { createRun, listRuns } from "../../../src/storage/repositories/run-repository.js";
import {
  dispatchOccurrence,
  initializeNullSchedules,
  listQueuedRuns,
  skipMissedOccurrences,
} from "../../../src/storage/repositories/scheduler-repository.js";
import {
  createTestDatabase,
  createTestJob,
  createTestRun,
  type TestDb,
} from "../../fixtures/database.js";

const now = 1_700_000_000_000 as UTCTimestamp;

function activeJob(id: string, overrides: Partial<ReturnType<typeof createTestJob>> = {}) {
  return createTestJob({
    id,
    createdAt: now,
    updatedAt: now,
    nextRunAt: now,
    approvedFingerprint: "a".repeat(64),
    ...overrides,
  });
}

describe("durable scheduler repository mutations", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it("deduplicates an occurrence and advances only once", () => {
    const job = activeJob("dispatch-duplicate");
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({
      id: "run-duplicate",
      jobId: job.id,
      occurrenceKey: "interval:duplicate",
      occurrenceAt: now,
    });
    const mutation = { job, run, nextRunAt: (now + 60_000) as UTCTimestamp };
    expect(dispatchOccurrence(db.adapter, mutation, now, false).ok).toBe(true);
    const duplicate = dispatchOccurrence(
      db.adapter,
      mutation,
      (now + 60_000) as UTCTimestamp,
      false,
    );
    expect(duplicate.ok && duplicate.value.kind).toBe("already_dispatched");
    expect(listQueuedRuns(db.adapter, 10)).toHaveLength(1);
  });

  it("rejects stale, inactive, and no-longer-due dispatches", () => {
    const job = activeJob("dispatch-errors");
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ jobId: job.id });
    const stale = dispatchOccurrence(
      db.adapter,
      { job: { ...job, revision: 2 }, run, nextRunAt: now, disableJob: false },
      now,
      false,
    );
    expect(!stale.ok && stale.error.code).toBe("REVISION_CONFLICT");

    db.adapter.run("UPDATE jobs SET status = 'paused' WHERE id = ?", job.id);
    const inactive = dispatchOccurrence(db.adapter, { job, run, nextRunAt: now }, now, false);
    expect(!inactive.ok && inactive.error.code).toBe("APPROVAL_REQUIRED");

    db.adapter.run(
      "UPDATE jobs SET status = 'active', next_run_at = ? WHERE id = ?",
      new Date(now + 60_000).toISOString(),
      job.id,
    );
    const early = dispatchOccurrence(db.adapter, { job, run, nextRunAt: now }, now, false);
    expect(!early.ok && early.error.code).toBe("SCHEDULER_STOPPED");
  });

  it("updates missed schedules with CAS and materializes null schedules", () => {
    const job = activeJob("dispatch-skip");
    expect(createJob(db.adapter, job).ok).toBe(true);
    expect(
      skipMissedOccurrences(db.adapter, job.id, (now + 60_000) as UTCTimestamp, now, false, 1).ok,
    ).toBe(true);
    db.adapter.run("UPDATE jobs SET revision = 2 WHERE id = ?", job.id);
    const conflict = skipMissedOccurrences(db.adapter, job.id, now, now, false, 1);
    expect(!conflict.ok && conflict.error.code).toBe("REVISION_CONFLICT");

    const uninitialized = activeJob("dispatch-null", {
      nextRunAt: null,
      definition: { name: "null-job" } as never,
    });
    expect(createJob(db.adapter, uninitialized).ok).toBe(true);
    initializeNullSchedules(db.adapter, now, createCronCalculator());
    const runs = listRuns(db.adapter, { jobId: uninitialized.id, limit: 10 });
    expect(runs.ok && runs.value.runs).toHaveLength(0);
    const next = db.adapter.get<{ next_run_at: string | null }>(
      "SELECT next_run_at FROM jobs WHERE id = ?",
      uninitialized.id,
    );
    expect(next?.next_run_at).not.toBeNull();
    const invalid = activeJob("dispatch-invalid", {
      nextRunAt: null,
      definition: {
        name: "invalid-job",
        schedule: { kind: "cron", expression: "bad", timezone: "UTC" },
      } as never,
    });
    expect(createJob(db.adapter, invalid).ok).toBe(true);
    initializeNullSchedules(db.adapter, now, {
      validate: () => ({ ok: true, value: { expression: "bad", valid: true } }),
      nextAfter: () => ({ ok: false, error: new Error("cron failed") }),
    } as never);
    expect(
      db.adapter.get<{ next_run_at: string | null }>(
        "SELECT next_run_at FROM jobs WHERE id = ?",
        invalid.id,
      )?.next_run_at,
    ).toBeNull();
  });

  it("returns bounded queued rows", () => {
    const job = activeJob("dispatch-list");
    expect(createJob(db.adapter, job).ok).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(createRun(db.adapter, createTestRun({ jobId: job.id, id: `queued-${i}` })).ok).toBe(
        true,
      );
    }
    expect(listQueuedRuns(db.adapter, 2)).toHaveLength(2);
    expect(listQueuedRuns(db.adapter, -1)).toHaveLength(0);
  });
});

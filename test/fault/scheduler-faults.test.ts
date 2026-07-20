import type { SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExecutionPump } from "../../src/scheduler/execution-pump.js";
import { createLeaseCoordinator } from "../../src/scheduler/lease-coordinator.js";
import { createEventBus } from "../../src/shared/event-bus.js";
import type { DatabaseAdapter } from "../../src/storage/database.js";
import { createJob } from "../../src/storage/repositories/job-repository.js";
import {
  claimRun,
  createRun,
  getRunById,
  listRuns,
} from "../../src/storage/repositories/run-repository.js";
import { dispatchOccurrence } from "../../src/storage/repositories/scheduler-repository.js";
import {
  createTestDatabase,
  createTestJob,
  createTestRun,
  type TestDb,
} from "../fixtures/database.js";
import { createFakeClock } from "../fixtures/fake-clock.js";

const now = 1_700_000_000_000 as never;

describe("scheduler transaction fault injection", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it("rolls back a dispatch if advancing the job fails after run insertion", () => {
    const job = createTestJob({
      id: "fault-dispatch",
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
      approvedFingerprint: "a".repeat(64),
    });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "fault-dispatch-run", jobId: job.id });
    const failing: DatabaseAdapter = {
      ...db.adapter,
      run: (sql: string, ...params: SQLInputValue[]) => {
        if (sql.includes("UPDATE jobs SET next_run_at")) throw new Error("crash after insert");
        return db.adapter.run(sql, ...params);
      },
    };
    const result = dispatchOccurrence(
      failing,
      { job, run, nextRunAt: (now + 60_000) as never },
      now,
      false,
    );
    expect(!result.ok && result.error.code).toBe("INTERNAL_ERROR");
    const runs = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(runs.ok && runs.value.runs).toHaveLength(0);
  });

  it("reports lease-renewal loss without mutating the former owner's run", () => {
    const clock = createFakeClock(now);
    const job = createTestJob({ id: "fault-lease-job", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "fault-lease-run", jobId: job.id });
    expect(createRun(db.adapter, run).ok).toBe(true);
    expect(claimRun(db.adapter, run.id, "owner", (now + 1_000) as never, now).ok).toBe(true);
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const failing: DatabaseAdapter = {
      ...db.adapter,
      run: (sql: string, ...params: SQLInputValue[]) => {
        if (sql.includes("SET lease_expires_at")) throw new Error("renewal channel lost");
        return db.adapter.run(sql, ...params);
      },
    };
    const coordinator = createLeaseCoordinator({
      adapter: failing,
      clock,
      ownerId: "owner",
      leaseMs: 2_000,
      renewEveryMs: 500,
      events,
    });
    coordinator.start();
    clock.advance(500);
    expect(seen).toContain("run.lease_expired");
    const reloaded = getRunById(db.adapter, run.id);
    expect(reloaded.ok && reloaded.value?.leaseDeadline).toBe((now + 1_000) as never);
    coordinator.stop();
  });

  it("rolls back terminal persistence when job counters fail", async () => {
    const job = createTestJob({ id: "fault-counter-job", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "fault-counter-run", jobId: job.id });
    expect(createRun(db.adapter, run).ok).toBe(true);
    const failing: DatabaseAdapter = {
      ...db.adapter,
      run: (sql: string, ...params: SQLInputValue[]) => {
        if (sql.includes("UPDATE jobs SET")) throw new Error("counter store unavailable");
        return db.adapter.run(sql, ...params);
      },
    };
    const pump = createExecutionPump({
      adapter: failing,
      clock: createFakeClock(now),
      instanceId: "fault-counter-owner",
      execute: async () => ({ status: "succeeded" as const }),
    });
    pump.start();
    await pump.wake();
    const reloaded = getRunById(db.adapter, run.id);
    expect(reloaded.ok && reloaded.value?.status).toBe("running");
    await pump.stop();
  });

  it("rolls back a claim if the row disappears at the post-CAS read", () => {
    const job = createTestJob({ id: "fault-claim", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "fault-claim-run", jobId: job.id });
    expect(createRun(db.adapter, run).ok).toBe(true);
    let hideClaimedRow = false;
    const failing: DatabaseAdapter = {
      ...db.adapter,
      run: (sql: string, ...params: SQLInputValue[]) => {
        const result = db.adapter.run(sql, ...params);
        if (sql.includes("SET status = 'claimed'")) hideClaimedRow = true;
        return result;
      },
      get: <T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]) => {
        if (hideClaimedRow && sql === "SELECT * FROM job_runs WHERE id = ?") {
          hideClaimedRow = false;
          return undefined;
        }
        return db.adapter.get<T>(sql, ...params);
      },
    };
    const result = claimRun(failing, run.id, "owner", (now + 60_000) as never, now);
    expect(!result.ok && result.error.code).toBe("INTERNAL_ERROR");
    const reloaded = getRunById(db.adapter, run.id);
    expect(reloaded.ok && reloaded.value?.status).toBe("queued");
  });
});

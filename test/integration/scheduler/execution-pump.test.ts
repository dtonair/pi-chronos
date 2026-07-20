import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createExecutionPump } from "../../../src/scheduler/execution-pump.js";
import { createJob } from "../../../src/storage/repositories/job-repository.js";
import { createRun, listRuns } from "../../../src/storage/repositories/run-repository.js";
import {
  createTestDatabase,
  createTestJob,
  createTestRun,
  type TestDb,
} from "../../fixtures/database.js";
import { createFakeClock } from "../../fixtures/fake-clock.js";

const now = 1_700_000_000_000 as UTCTimestamp;

describe("bounded durable execution pump", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => {
    db.close();
  });

  it("converts executor exceptions into failed durable runs", async () => {
    const job = createTestJob({ id: "job-pump-fail", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "run-pump-fail", jobId: job.id });
    expect(createRun(db.adapter, run).ok).toBe(true);
    const pump = createExecutionPump({
      adapter: db.adapter,
      clock: createFakeClock(now),
      instanceId: "instance-pump-fail",
      execute: async () => {
        throw new Error("executor exploded");
      },
    });
    pump.start();
    await pump.wake();
    const result = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(result.ok && result.value.runs[0]?.status).toBe("failed");
    expect(
      db.adapter.get<{ error_message: string }>(
        "SELECT error_message FROM job_runs WHERE id = ?",
        run.id,
      )?.error_message,
    ).toBe("executor exploded");
    expect(pump.cancel("missing-run")).toBe(false);
    await pump.stop();
  });

  it("does not overwrite a run after its lease expires", async () => {
    const job = createTestJob({ id: "job-pump-expired", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    expect(createRun(db.adapter, createTestRun({ id: "run-pump-expired", jobId: job.id })).ok).toBe(
      true,
    );
    const clock = createFakeClock(now);
    const pump = createExecutionPump({
      adapter: db.adapter,
      clock,
      instanceId: "instance-pump-expired",
      leaseMs: 1_000,
      execute: async () => {
        clock.advance(2_000);
        return { status: "succeeded" };
      },
    });
    pump.start();
    await pump.wake();
    const result = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(result.ok && result.value.runs[0]?.status).toBe("running");
    await pump.stop();
  });

  it("skips a corrupt queued row without crashing the pump", async () => {
    const job = createTestJob({ id: "job-pump-corrupt", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "run-pump-corrupt", jobId: job.id });
    expect(createRun(db.adapter, run).ok).toBe(true);
    db.adapter.run("UPDATE job_runs SET metadata_json = ? WHERE id = ?", "{", run.id);
    let executed = false;
    const pump = createExecutionPump({
      adapter: db.adapter,
      clock: createFakeClock(now),
      instanceId: "instance-pump-corrupt",
      execute: async () => {
        executed = true;
        return { status: "succeeded" };
      },
    });
    pump.start();
    await pump.wake();
    expect(executed).toBe(false);
    const persisted = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(!persisted.ok && persisted.error.code).toBe("DB_CORRUPT_ROW");
    await pump.stop();
  });

  it("aborts an active executor through cancel", async () => {
    const job = createTestJob({ id: "job-pump-cancel", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "run-pump-cancel", jobId: job.id });
    expect(createRun(db.adapter, run).ok).toBe(true);
    const pump = createExecutionPump({
      adapter: db.adapter,
      clock: createFakeClock(now),
      instanceId: "instance-pump-cancel",
      execute: async (_run, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true });
        }),
    });
    pump.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pump.cancel(run.id)).toBe(true);
    await pump.wake();
    const result = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(result.ok && result.value.runs[0]?.status).toBe("cancelled");
    await pump.stop();
  });

  it("claims durable queued rows and never exceeds configured concurrency", async () => {
    const job = createTestJob({ id: "job-pump", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    expect(createRun(db.adapter, createTestRun({ id: "run-pump-1", jobId: job.id })).ok).toBe(true);
    expect(createRun(db.adapter, createTestRun({ id: "run-pump-2", jobId: job.id })).ok).toBe(true);

    let active = 0;
    let maximum = 0;
    const pump = createExecutionPump({
      adapter: db.adapter,
      clock: createFakeClock(now),
      instanceId: "instance-pump",
      concurrency: 1,
      execute: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
        return { status: "succeeded" };
      },
    });
    pump.start();
    await pump.wake();
    expect(maximum).toBe(1);
    const runs = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(runs.ok).toBe(true);
    if (runs.ok) expect(runs.value.runs.every((run) => run.status === "succeeded")).toBe(true);
    await pump.stop();
  });
});

import type { SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSchedulerEngine } from "../../../src/scheduler/engine.js";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import type { DatabaseAdapter } from "../../../src/storage/database.js";
import { createJob, getJobById } from "../../../src/storage/repositories/job-repository.js";
import { listRuns } from "../../../src/storage/repositories/run-repository.js";
import { createTestDatabase, createTestJob, type TestDb } from "../../fixtures/database.js";
import { createFakeClock } from "../../fixtures/fake-clock.js";

const now = 1_700_000_000_000 as never;

describe("scheduler engine lifecycle", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it("records and emits a dispatch failure caused by a stale due query", async () => {
    const clock = createFakeClock(now);
    const job = createTestJob({
      id: "engine-error-job",
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
      approvedFingerprint: "a".repeat(64),
    });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const errors: string[] = [];
    const logger = {
      level: "info" as const,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message: string) => errors.push(message),
    };
    let injected = false;
    const adapter: DatabaseAdapter = {
      ...db.adapter,
      all: <T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] => {
        const rows = db.adapter.all<T>(sql, ...params);
        if (!injected && sql.includes("next_run_at <=")) {
          injected = true;
          db.adapter.run("UPDATE jobs SET revision = 2 WHERE id = ?", job.id);
        }
        return rows;
      },
    } as DatabaseAdapter;
    const engine = createSchedulerEngine({
      adapter,
      clock,
      ids: createDeterministicIdGenerator("engine-error-"),
      instanceId: "engine-error-instance",
      events,
      logger,
    });
    engine.start();
    expect(engine.lastError?.code).toBe("REVISION_CONFLICT");
    expect(seen).toContain("scheduler.error");
    expect(errors).toContain("Scheduler dispatch failed");
    await engine.stop();
  });

  it("reloads durable fixed-rate state without restarting from the wall clock", async () => {
    const clock = createFakeClock(now);
    const ids = createDeterministicIdGenerator("restart-");
    const job = createTestJob({
      id: "restart-job",
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
      approvedFingerprint: "a".repeat(64),
      definition: {
        ...createTestJob().definition,
        schedule: { kind: "interval", everyMs: 60_000 },
      },
    });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const executor = async () => ({
      status: "succeeded" as const,
      output: { summary: "ok", truncated: false, totalBytes: 2 },
    });
    const first = createSchedulerEngine({
      adapter: db.adapter,
      clock,
      ids,
      instanceId: "restart-first",
      pump: { execute: executor, concurrency: 1, leaseMs: 2_000 },
    });
    first.start();
    await first.pump?.wake();
    await first.stop();
    clock.advance(60_000);
    const second = createSchedulerEngine({
      adapter: db.adapter,
      clock,
      ids,
      instanceId: "restart-second",
      pump: { execute: executor, concurrency: 1, leaseMs: 2_000 },
    });
    second.start();
    await second.pump?.wake();
    const runs = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(runs.ok && runs.value.runs).toHaveLength(2);
    await second.stop();
  });

  it("composes instance, timer, dispatch, and bounded execution pump", async () => {
    const clock = createFakeClock(now);
    const ids = createDeterministicIdGenerator("engine-");
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const job = createTestJob({
      id: "engine-job",
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
      approvedFingerprint: "a".repeat(64),
    });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const engine = createSchedulerEngine({
      adapter: db.adapter,
      clock,
      ids,
      instanceId: "engine-instance",
      events,
      pump: {
        execute: async () => ({
          status: "succeeded",
          output: { summary: "ok", truncated: false, totalBytes: 2 },
        }),
        concurrency: 1,
        leaseMs: 2_000,
      },
    });
    engine.start();
    engine.start();
    engine.wake();
    expect(engine.running).toBe(true);
    await engine.pump?.wake();
    const runs = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(runs.ok && runs.value.runs[0]?.status).toBe("succeeded");
    expect(seen).toContain("instance.registered");
    expect(seen).toContain("run.claimed");
    expect(seen).toContain("run.started");
    expect(seen).toContain("run.finished");
    await engine.stop();
    await engine.stop();
    engine.wake();
    expect(engine.running).toBe(false);
    expect(getJobById(db.adapter, job.id).ok).toBe(true);

    const noPump = createSchedulerEngine({
      adapter: db.adapter,
      clock,
      ids,
      instanceId: "engine-no-pump",
    });
    noPump.start();
    expect(noPump.running).toBe(true);
    await noPump.stop();
    expect(noPump.running).toBe(false);
  });
});

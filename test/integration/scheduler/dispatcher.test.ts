import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createCronCalculator } from "../../../src/scheduler/cron.js";
import { createDispatcher } from "../../../src/scheduler/dispatcher.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
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

describe("transactional scheduler dispatcher", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => {
    db.close();
  });

  function dispatcher(cronCalc = createCronCalculator()) {
    return createDispatcher({
      adapter: db.adapter,
      clock: createFakeClock(now),
      ids: createDeterministicIdGenerator("run-"),
      instanceId: "instance-a",
      cronCalc,
    });
  }

  it("queues a due approved occurrence and advances the next run atomically", () => {
    const job = createTestJob({ createdAt: now, updatedAt: now, nextRunAt: now });
    expect(
      db.adapter.run(
        `INSERT INTO jobs (id, schema_version, name, normalized_name, description, prompt, status,
       scope, scope_key, source, import_key, schedule_json, execution_json, permissions_json,
       approval_required, approved_fingerprint, next_run_at, last_scheduled_at, last_run_at,
       last_success_at, consecutive_failures, diagnostic_code, diagnostic_message, created_at,
       created_by, updated_at, updated_by, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, ?, ?, ?, ?, ?)`,
        job.id,
        1,
        job.definition.name,
        job.definition.name,
        null,
        job.definition.prompt,
        "active",
        job.definition.identity.scope,
        job.definition.identity.scopeKey,
        job.definition.source,
        null,
        JSON.stringify({ schemaVersion: 1, value: job.definition.schedule }),
        JSON.stringify({
          schemaVersion: 1,
          model: job.definition.model,
          ...job.definition.execution,
        }),
        JSON.stringify({ schemaVersion: 1, value: job.definition.permissions }),
        job.fingerprint,
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        job.createdBy,
        new Date(now).toISOString(),
        job.updatedBy,
        1,
      ).changes,
    ).toBe(1);

    const result = dispatcher().dispatchDue(now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queued).toBe(1);
    const runs = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(runs.ok).toBe(true);
    if (!runs.ok) return;
    expect(runs.value.runs).toHaveLength(1);
    expect(runs.value.runs[0]?.status).toBe("queued");
    expect(runs.value.runs[0]?.occurrenceKey).toContain("interval:");
    const next = db.adapter.get<{ next_run_at: string }>(
      "SELECT next_run_at FROM jobs WHERE id = ?",
      job.id,
    );
    expect(Date.parse(next?.next_run_at ?? "")).toBeGreaterThan(now);
    // Simulate a stale second due query after the first transaction inserted
    // the occurrence; the dispatcher must report a benign duplicate.
    db.adapter.run(
      "UPDATE jobs SET next_run_at = ? WHERE id = ?",
      new Date(now).toISOString(),
      job.id,
    );
    const staleDispatch = dispatcher().dispatchDue(now);
    expect(staleDispatch.ok && staleDispatch.value.alreadyDispatched).toBe(1);
  });

  it("disables a due one-time job in the same dispatch transaction", () => {
    const job = createTestJob({
      id: "job-once",
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
      definition: {
        schedule: {
          kind: "once",
          runAt: new Date(now).toISOString(),
          timezone: "UTC",
        },
      } as never,
    });
    expect(
      db.adapter.run(
        `INSERT INTO jobs (id, schema_version, name, normalized_name, prompt, status, scope, scope_key,
       source, schedule_json, execution_json, permissions_json, approval_required, approved_fingerprint,
       next_run_at, consecutive_failures, created_at, created_by, updated_at, updated_by, revision)
       VALUES (?, 1, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 1)`,
        job.id,
        job.definition.name,
        job.definition.name,
        job.definition.prompt,
        job.definition.identity.scope,
        job.definition.identity.scopeKey,
        job.definition.source,
        JSON.stringify({ schemaVersion: 1, value: job.definition.schedule }),
        JSON.stringify({
          schemaVersion: 1,
          model: job.definition.model,
          ...job.definition.execution,
        }),
        JSON.stringify({ schemaVersion: 1, value: job.definition.permissions }),
        job.fingerprint,
        new Date(now).toISOString(),
        new Date(now).toISOString(),
        "test",
        new Date(now).toISOString(),
        "test",
      ).changes,
    ).toBe(1);
    const result = dispatcher().dispatchDue(now);
    expect(result.ok && result.value.queued).toBe(1);
    const row = db.adapter.get<{ status: string; next_run_at: string | null }>(
      "SELECT status, next_run_at FROM jobs WHERE id = ?",
      job.id,
    );
    expect(row).toEqual({ status: "disabled", next_run_at: null });
  });

  it("collapses multiple missed intervals into one future catch-up run", () => {
    const dueAt = (now - 5 * 3_600_000) as UTCTimestamp;
    const job = createTestJob({
      id: "job-catchup",
      createdAt: now,
      updatedAt: now,
      nextRunAt: dueAt,
      definition: {
        execution: {
          ...createTestJob().definition.execution,
          missedRunPolicy: "run_once",
        },
      } as never,
    });
    db.adapter.run(
      `INSERT INTO jobs (id, schema_version, name, normalized_name, prompt, status, scope, scope_key,
       source, schedule_json, execution_json, permissions_json, approval_required, approved_fingerprint,
       next_run_at, consecutive_failures, created_at, created_by, updated_at, updated_by, revision)
       VALUES (?, 1, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 1)`,
      job.id,
      job.definition.name,
      job.definition.name,
      job.definition.prompt,
      job.definition.identity.scope,
      job.definition.identity.scopeKey,
      job.definition.source,
      JSON.stringify({ schemaVersion: 1, value: job.definition.schedule }),
      JSON.stringify({
        schemaVersion: 1,
        model: job.definition.model,
        ...job.definition.execution,
      }),
      JSON.stringify({ schemaVersion: 1, value: job.definition.permissions }),
      job.fingerprint,
      new Date(dueAt).toISOString(),
      new Date(now).toISOString(),
      "test",
      new Date(now).toISOString(),
      "test",
    );
    const result = dispatcher().dispatchDue(now);
    expect(result.ok && result.value.catchUps).toBe(1);
    const row = db.adapter.get<{ next_run_at: string | null }>(
      "SELECT next_run_at FROM jobs WHERE id = ?",
      job.id,
    );
    expect(Date.parse(row?.next_run_at ?? "")).toBeGreaterThan(now);
    const runs = listRuns(db.adapter, { jobId: job.id, limit: 10 });
    expect(runs.ok && runs.value.runs[0]?.catchUpCount).toBe(5);
  });

  it("skips missed work without creating a run", () => {
    const job = createTestJob({
      id: "job-missed-skip",
      createdAt: now,
      updatedAt: now,
      nextRunAt: (now - 3 * 3_600_000) as UTCTimestamp,
    });
    expect(
      db.adapter.run(
        `INSERT INTO jobs (id, schema_version, name, normalized_name, prompt, status, scope, scope_key,
       source, schedule_json, execution_json, permissions_json, approval_required, approved_fingerprint,
       next_run_at, consecutive_failures, created_at, created_by, updated_at, updated_by, revision)
       VALUES (?, 1, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 1)`,
        job.id,
        job.definition.name,
        job.definition.name,
        job.definition.prompt,
        job.definition.identity.scope,
        job.definition.identity.scopeKey,
        job.definition.source,
        JSON.stringify({ schemaVersion: 1, value: job.definition.schedule }),
        JSON.stringify({
          schemaVersion: 1,
          model: job.definition.model,
          ...job.definition.execution,
        }),
        JSON.stringify({ schemaVersion: 1, value: job.definition.permissions }),
        job.fingerprint,
        new Date(now - 3 * 3_600_000).toISOString(),
        new Date(now).toISOString(),
        "test",
        new Date(now).toISOString(),
        "test",
      ).changes,
    ).toBe(1);
    const result = dispatcher().dispatchDue(now);
    expect(result.ok && result.value.skipped).toBe(1);
    expect(listRuns(db.adapter, { jobId: job.id, limit: 10 }).ok).toBe(true);
  });

  it("dispatches a bounded batch from 1,000 due jobs", () => {
    for (let index = 0; index < 1_000; index += 1) {
      const job = createTestJob({
        id: `bulk-job-${index}`,
        createdAt: now,
        updatedAt: now,
        nextRunAt: now,
        approvedFingerprint: "a".repeat(64),
        definition: { ...createTestJob().definition, name: `bulk-${index}` },
      });
      expect(createJob(db.adapter, job).ok).toBe(true);
    }
    const result = createDispatcher({
      adapter: db.adapter,
      clock: createFakeClock(now),
      ids: createDeterministicIdGenerator("bulk-run-"),
      instanceId: "bulk-instance",
      batchSize: 100,
    }).dispatchDue(now);
    expect(result.ok && result.value.examined).toBe(100);
    expect(result.ok && result.value.queued).toBe(100);
    expect(db.adapter.get<{ count: number }>("SELECT COUNT(*) AS count FROM job_runs")?.count).toBe(
      100,
    );
  });

  it("returns schedule calculation errors without mutating storage", () => {
    const invalid = createTestJob({
      id: "job-invalid-cron",
      nextRunAt: now,
      definition: {
        schedule: { kind: "cron", expression: "not valid", timezone: "UTC" },
      } as never,
    });
    const result = dispatcher().dispatchJob(invalid, now);
    expect(result.ok).toBe(false);
  });

  it("treats a job with no next run as a missed candidate", () => {
    const job = { ...createTestJob({ id: "job-no-next" }), nextRunAt: null };
    const result = dispatcher().dispatchJob(job, now);
    expect(result.ok && result.value.kind).toBe("missed");
  });

  it("records overlap as a durable skipped run", () => {
    const job = createTestJob({ createdAt: now, updatedAt: now, nextRunAt: now });
    const insert = createRun(
      db.adapter,
      createTestRun({
        jobId: job.id,
        status: "running",
        occurrenceAt: (now - 1_000) as UTCTimestamp,
      }),
    );
    // The first attempt intentionally fails because the foreign-key job does not
    // exist yet; the database remains usable after the rollback.
    if (insert.ok) throw new Error("foreign-key fixture unexpectedly succeeded");
    db.adapter.run(
      `INSERT INTO jobs (id, schema_version, name, normalized_name, prompt, status, scope, scope_key,
       source, schedule_json, execution_json, permissions_json, approval_required, approved_fingerprint,
       next_run_at, consecutive_failures, created_at, created_by, updated_at, updated_by, revision)
       VALUES (?, 1, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 1)`,
      job.id,
      job.definition.name,
      job.definition.name,
      job.definition.prompt,
      job.definition.identity.scope,
      job.definition.identity.scopeKey,
      job.definition.source,
      JSON.stringify({ schemaVersion: 1, value: job.definition.schedule }),
      JSON.stringify({
        schemaVersion: 1,
        model: job.definition.model,
        ...job.definition.execution,
      }),
      JSON.stringify({ schemaVersion: 1, value: job.definition.permissions }),
      job.fingerprint,
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      "test",
      new Date(now).toISOString(),
      "test",
    );
    expect(
      createRun(
        db.adapter,
        createTestRun({
          jobId: job.id,
          status: "running",
          occurrenceAt: (now - 1_000) as UTCTimestamp,
        }),
      ).ok,
    ).toBe(true);
    const result = dispatcher().dispatchDue(now);
    expect(result.ok).toBe(true);
    const runs = listRuns(db.adapter, { jobId: job.id, status: "skipped", limit: 10 });
    expect(runs.ok && runs.value.runs[0]?.skipReason).toBe("OVERLAP_SKIPPED");
  });
});

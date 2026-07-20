import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { type DatabaseAdapter, openDatabase } from "../../../src/storage/database.js";
import { createMigrations } from "../../../src/storage/migrations.js";
import { createJob } from "../../../src/storage/repositories/job-repository.js";
import {
  claimRun,
  createRun,
  renewRunLease,
  transitionRunStatus,
} from "../../../src/storage/repositories/run-repository.js";
import { createConcurrencyBarrier } from "../../fixtures/concurrency-barrier.js";
import {
  createTestDatabase,
  createTestJob,
  createTestRun,
  type TestDb,
} from "../../fixtures/database.js";

const schema = readFileSync(
  new URL("../../../src/storage/schema/001_initial.sql", import.meta.url),
  "utf8",
);
const now = 1_700_000_000_000 as UTCTimestamp;

describe("multi-instance run ownership", () => {
  let db: TestDb;
  let second: DatabaseAdapter;

  beforeEach(() => {
    db = createTestDatabase();
    const opened = openDatabase(
      { path: join(db.dir, "test.db"), create: true },
      createMigrations([schema]),
    );
    if (!opened.ok) throw opened.error;
    second = opened.value;
  });

  afterEach(() => {
    try {
      second.close();
    } finally {
      db.close();
    }
  });

  it("allows exactly one of two database connections to claim a queued run", async () => {
    const job = createTestJob({ id: "job-race", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "run-race", jobId: job.id, occurrenceAt: now });
    expect(createRun(db.adapter, run).ok).toBe(true);

    const barrier = createConcurrencyBarrier(2);
    const attempt = async (adapter: DatabaseAdapter, owner: string) => {
      barrier.hit();
      await barrier.reached;
      return claimRun(adapter, run.id, owner, (now + 60_000) as UTCTimestamp, now);
    };
    const results = await Promise.all([
      attempt(db.adapter, "instance-a"),
      attempt(second, "instance-b"),
    ]);
    expect(barrier.count).toBe(2);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it("renews only the owner lease and rejects late state mutation", () => {
    const job = createTestJob({ id: "job-lease", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "run-lease", jobId: job.id, occurrenceAt: now });
    expect(createRun(db.adapter, run).ok).toBe(true);
    expect(claimRun(db.adapter, run.id, "instance-a", (now + 1_000) as UTCTimestamp, now).ok).toBe(
      true,
    );
    expect(renewRunLease(second, run.id, "instance-b", (now + 60_000) as UTCTimestamp).ok).toBe(
      false,
    );
    expect(
      transitionRunStatus(second, run.id, "instance-b", "succeeded", (now + 100) as UTCTimestamp)
        .ok,
    ).toBe(false);
    expect(
      transitionRunStatus(db.adapter, run.id, "instance-a", "running", (now + 100) as UTCTimestamp)
        .ok,
    ).toBe(true);
  });
});

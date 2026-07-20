import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SchedulerInstance } from "../../../src/domain/instance.js";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createRecoveryCoordinator, recoverStaleRuns } from "../../../src/scheduler/recovery.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import { registerInstance } from "../../../src/storage/repositories/instance-repository.js";
import { createJob } from "../../../src/storage/repositories/job-repository.js";
import {
  claimRun,
  createRun,
  getRunById,
} from "../../../src/storage/repositories/run-repository.js";
import {
  createTestDatabase,
  createTestJob,
  createTestRun,
  type TestDb,
} from "../../fixtures/database.js";
import { createFakeClock } from "../../fixtures/fake-clock.js";

describe("scheduler lease recovery", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => {
    db.close();
  });

  it("requires both a stale owner and an expired lease", () => {
    const now = 1_700_000_100_000 as UTCTimestamp;
    const clock = createFakeClock(now);
    const ids = createDeterministicIdGenerator("rel-");
    const job = createTestJob({
      createdAt: now,
      updatedAt: now,
      nextRunAt: (now + 60_000) as UTCTimestamp,
    });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ jobId: job.id, occurrenceAt: now });
    expect(createRun(db.adapter, run).ok).toBe(true);
    expect(
      claimRun(db.adapter, run.id, "owner-a", (now - 1) as UTCTimestamp, (now - 2) as UTCTimestamp)
        .ok,
    ).toBe(true);

    const instance: SchedulerInstance = {
      id: "owner-a",
      hostname: "test",
      processId: 1,
      startedAt: (now - 100_000) as UTCTimestamp,
      heartbeatAt: (now - 60_000) as UTCTimestamp,
    };
    expect(registerInstance(db.adapter, instance).ok).toBe(true);
    const healthyRun = createTestRun({ id: "healthy-owner-run", jobId: job.id });
    expect(createRun(db.adapter, healthyRun).ok).toBe(true);
    expect(
      claimRun(
        db.adapter,
        healthyRun.id,
        "owner-b",
        (now - 1) as UTCTimestamp,
        (now - 2) as UTCTimestamp,
      ).ok,
    ).toBe(true);
    expect(
      registerInstance(db.adapter, {
        ...instance,
        id: "owner-b",
        heartbeatAt: now,
      }).ok,
    ).toBe(true);
    const result = recoverStaleRuns({ adapter: db.adapter, clock, ids, ownerStaleMs: 30_000 });
    expect(result.recovered).toBe(1);
    expect(result.ignored).toBe(1);
    const coordinator = createRecoveryCoordinator({
      adapter: db.adapter,
      clock,
      ids,
      ownerStaleMs: 30_000,
    });
    expect(coordinator.recover().recovered).toBe(0);
    const reloaded = getRunById(db.adapter, run.id);
    expect(reloaded.ok && reloaded.value?.status).toBe("abandoned");
  });
});

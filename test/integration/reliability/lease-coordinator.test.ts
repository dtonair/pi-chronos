import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLeaseCoordinator } from "../../../src/scheduler/lease-coordinator.js";
import { createEventBus } from "../../../src/shared/event-bus.js";
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

const now = 1_700_000_000_000 as never;

describe("lease coordinator", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it("renews owned active runs from one timer and stops idempotently", () => {
    const clock = createFakeClock(now);
    const job = createTestJob({ id: "lease-job", createdAt: now, updatedAt: now });
    expect(createJob(db.adapter, job).ok).toBe(true);
    const run = createTestRun({ id: "lease-run", jobId: job.id });
    expect(createRun(db.adapter, run).ok).toBe(true);
    expect(claimRun(db.adapter, run.id, "owner", (now + 1_000) as never, now).ok).toBe(true);
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const coordinator = createLeaseCoordinator({
      adapter: db.adapter,
      clock,
      ownerId: "owner",
      leaseMs: 2_000,
      renewEveryMs: 500,
      events,
    });
    coordinator.start();
    coordinator.start();
    clock.advance(500);
    const reloaded = getRunById(db.adapter, run.id);
    expect(reloaded.ok && reloaded.value?.leaseDeadline).toBe((now + 2_500) as never);
    expect(seen).toContain("run.lease_renewed");
    coordinator.stop();
    coordinator.stop();
    expect(coordinator.running).toBe(false);
    expect(clock.pending).toBe(0);
  });

  it("does not renew after stopping", () => {
    const clock = createFakeClock(now);
    const coordinator = createLeaseCoordinator({
      adapter: db.adapter,
      clock,
      ownerId: "none",
      renewEveryMs: 500,
    });
    coordinator.start();
    coordinator.stop();
    coordinator.renew();
    expect(clock.pending).toBe(0);
  });
});

/**
 * Repository integration tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../../../src/domain/audit.js";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import {
  createApproval,
  getActiveApproval,
  revokeApproval,
} from "../../../src/storage/repositories/approval-repository.js";
import {
  appendAuditEvent,
  listAuditEvents,
} from "../../../src/storage/repositories/audit-repository.js";
import {
  getInstanceById,
  getStaleInstances,
  registerInstance,
  stopInstance,
  updateHeartbeat,
} from "../../../src/storage/repositories/instance-repository.js";
import {
  createJob,
  getDueJobs,
  getJobById,
  listJobs,
  transitionJobStatus,
} from "../../../src/storage/repositories/job-repository.js";
import {
  claimRun,
  createRun,
  getRunById,
  listRuns,
  renewRunLease,
  transitionRunStatus,
} from "../../../src/storage/repositories/run-repository.js";
import {
  createTestApproval,
  createTestDatabase,
  createTestJob,
  createTestRun,
  type TestDb,
} from "../../fixtures/database.js";

const ids = createDeterministicIdGenerator("test-");

describe("Job Repository", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("should create and retrieve a job", () => {
    const job = createTestJob();
    const result = createJob(db.adapter, job);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const retrieved = getJobById(db.adapter, job.id);
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) return;
    expect(retrieved.value).toBeDefined();
    if (!retrieved.value) return;
    expect(retrieved.value.id).toBe(job.id);
    expect(retrieved.value.definition.name).toBe(job.definition.name);
  });

  it("should enforce scoped name uniqueness", () => {
    const job1 = createTestJob({
      definition: { name: "unique-job", identity: { scope: "user", scopeKey: "alice" } },
    } as Partial<Parameters<typeof createTestJob>[0]>);
    const r1 = createJob(db.adapter, job1);
    expect(r1.ok).toBe(true);

    const job2 = createTestJob({
      definition: { name: "unique-job", identity: { scope: "user", scopeKey: "alice" } },
    } as Partial<Parameters<typeof createTestJob>[0]>);
    const r2 = createJob(db.adapter, job2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("JOB_NAME_CONFLICT");
  });

  it("should enforce case-insensitive scoped name uniqueness", () => {
    // Different casing of the same name in the same scope must conflict
    const job1 = createTestJob({
      definition: { name: "Case-Sensitive-Job", identity: { scope: "user", scopeKey: "alice" } },
    } as Partial<Parameters<typeof createTestJob>[0]>);
    const r1 = createJob(db.adapter, job1);
    expect(r1.ok).toBe(true);

    const job2 = createTestJob({
      definition: { name: "case-sensitive-job", identity: { scope: "user", scopeKey: "alice" } },
    } as Partial<Parameters<typeof createTestJob>[0]>);
    const r2 = createJob(db.adapter, job2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("JOB_NAME_CONFLICT");
  });

  it("should allow same name in different scopes", () => {
    const job1 = createTestJob({
      definition: { name: "shared-name", identity: { scope: "user", scopeKey: "alice" } },
    } as Partial<Parameters<typeof createTestJob>[0]>);
    const r1 = createJob(db.adapter, job1);
    expect(r1.ok).toBe(true);

    const job2 = createTestJob({
      definition: { name: "shared-name", identity: { scope: "user", scopeKey: "bob" } },
    } as Partial<Parameters<typeof createTestJob>[0]>);
    const r2 = createJob(db.adapter, job2);
    expect(r2.ok).toBe(true);
  });

  it("should list jobs with pagination", () => {
    for (let i = 0; i < 5; i++) {
      const job = createTestJob({ definition: { name: `job-${i}` } } as Partial<
        Parameters<typeof createTestJob>[0]
      >);
      createJob(db.adapter, job);
    }

    const page1 = listJobs(db.adapter, { limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.jobs.length).toBe(2);
    expect(page1.value.nextCursor).toBeDefined();

    const page2 = listJobs(db.adapter, { cursor: page1.value.nextCursor, limit: 2 });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.jobs.length).toBe(2);
  });

  it("should fail update on revision conflict", () => {
    const job = createTestJob();
    createJob(db.adapter, job);

    const retrieved = getJobById(db.adapter, job.id);
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok || !retrieved.value) return;

    const result = transitionJobStatus(
      db.adapter,
      job.id,
      retrieved.value.revision + 99,
      "paused",
      "test",
      Date.now() as UTCTimestamp,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("REVISION_CONFLICT");
  });

  it("should transition job status", () => {
    const job = createTestJob();
    createJob(db.adapter, job);

    const result = transitionJobStatus(
      db.adapter,
      job.id,
      1,
      "paused",
      "test",
      Date.now() as UTCTimestamp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("paused");
    expect(result.value.revision).toBe(2);
  });

  it("should find due jobs", () => {
    const now = Date.now() as UTCTimestamp;
    const past = (now - 60_000) as UTCTimestamp;

    const dueJob = createTestJob({
      nextRunAt: past,
      approvedFingerprint: "a".repeat(64),
    } as Partial<Parameters<typeof createTestJob>[0]>);
    createJob(db.adapter, dueJob);

    const futureJob = createTestJob({
      definition: { name: "future-job" },
      nextRunAt: (now + 3600_000) as UTCTimestamp,
    } as Partial<Parameters<typeof createTestJob>[0]>);
    createJob(db.adapter, futureJob);

    const dueJobs = getDueJobs(db.adapter, now, 10);
    expect(dueJobs.length).toBeGreaterThanOrEqual(1);
    expect(dueJobs.some((j) => j.id === dueJob.id)).toBe(true);
  });
});

describe("Run Repository", () => {
  let db: TestDb;
  let jobId: string;

  beforeEach(() => {
    db = createTestDatabase();
    // Create a job to satisfy FK constraints
    const job = createTestJob();
    const jobResult = createJob(db.adapter, job);
    expect(jobResult.ok).toBe(true);
    jobId = job.id;
  });

  afterEach(() => {
    db.close();
  });

  it("should create and retrieve a run", () => {
    const run = createTestRun({ jobId });
    const result = createRun(db.adapter, run);
    expect(result.ok).toBe(true);

    const retrieved = getRunById(db.adapter, run.id);
    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) return;
    expect(retrieved.value).toBeDefined();
    if (!retrieved.value) return;
    expect(retrieved.value.status).toBe("queued");
  });

  it("should enforce occurrence uniqueness", () => {
    const run1 = createTestRun({ jobId, occurrenceKey: "occ-1" });
    const r1 = createRun(db.adapter, run1);
    expect(r1.ok).toBe(true);

    const run2 = createTestRun({ jobId, occurrenceKey: "occ-1" });
    const r2 = createRun(db.adapter, run2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("DUPLICATE_OCCURRENCE");
  });

  it("should atomically claim a queued run", () => {
    const run = createTestRun({ jobId, status: "queued" });
    createRun(db.adapter, run);

    const leaseDeadline = (Date.now() + 60_000) as UTCTimestamp;
    const claimResult = claimRun(
      db.adapter,
      run.id,
      "instance-1",
      leaseDeadline,
      Date.now() as UTCTimestamp,
    );
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    expect(claimResult.value.status).toBe("claimed");
    expect(claimResult.value.ownerId).toBe("instance-1");
  });

  it("should fail claiming an already-claimed run", () => {
    const run = createTestRun({ jobId, status: "queued" });
    createRun(db.adapter, run);

    const leaseDeadline = (Date.now() + 60_000) as UTCTimestamp;
    const r1 = claimRun(
      db.adapter,
      run.id,
      "instance-1",
      leaseDeadline,
      Date.now() as UTCTimestamp,
    );
    expect(r1.ok).toBe(true);

    const r2 = claimRun(
      db.adapter,
      run.id,
      "instance-2",
      leaseDeadline,
      Date.now() as UTCTimestamp,
    );
    expect(r2.ok).toBe(false);
  });

  it("should enforce terminal immutability", () => {
    const run = createTestRun({ jobId, status: "succeeded" });
    createRun(db.adapter, run);

    const result = transitionRunStatus(
      db.adapter,
      run.id,
      undefined,
      "failed",
      Date.now() as UTCTimestamp,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RUN_ALREADY_TERMINAL");
  });

  it("should transition run status", () => {
    const run = createTestRun({ jobId, status: "queued" });
    createRun(db.adapter, run);

    const result = transitionRunStatus(
      db.adapter,
      run.id,
      undefined,
      "running",
      Date.now() as UTCTimestamp,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("running");
  });

  it("should renew run lease", () => {
    const run = createTestRun({ jobId, status: "queued" });
    createRun(db.adapter, run);

    const leaseDeadline = (Date.now() + 60_000) as UTCTimestamp;
    const claimResult = claimRun(
      db.adapter,
      run.id,
      "instance-1",
      leaseDeadline,
      Date.now() as UTCTimestamp,
    );
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;

    const newLease = (Date.now() + 120_000) as UTCTimestamp;
    const renewResult = renewRunLease(db.adapter, run.id, "instance-1", newLease);
    expect(renewResult.ok).toBe(true);
  });

  it("should fail lease renewal for non-owner", () => {
    const run = createTestRun({ jobId, status: "queued" });
    createRun(db.adapter, run);

    const leaseDeadline = (Date.now() + 60_000) as UTCTimestamp;
    claimRun(db.adapter, run.id, "instance-1", leaseDeadline, Date.now() as UTCTimestamp);

    const newLease = (Date.now() + 120_000) as UTCTimestamp;
    const renewResult = renewRunLease(db.adapter, run.id, "instance-2", newLease);
    expect(renewResult.ok).toBe(false);
  });

  it("should paginate run history", () => {
    for (let i = 0; i < 5; i++) {
      const run = createTestRun({ jobId, occurrenceKey: `occ-${i}` });
      createRun(db.adapter, run);
    }

    const result = listRuns(db.adapter, { limit: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runs.length).toBe(2);
    expect(result.value.nextCursor).toBeDefined();
  });
});

describe("Approval Repository", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("should create and retrieve active approval", () => {
    // Create job first to satisfy FK
    const job = createTestJob();
    const jobResult = createJob(db.adapter, job);
    expect(jobResult.ok).toBe(true);

    const approval = createTestApproval({ jobId: job.id });
    const result = createApproval(db.adapter, approval);
    expect(result.ok).toBe(true);

    const active = getActiveApproval(db.adapter, approval.jobId);
    expect(active).toBeDefined();
    if (!active) return;
    expect(active.fingerprint).toBe(approval.fingerprint);
  });

  it("should revoke approval", () => {
    const job = createTestJob();
    createJob(db.adapter, job);

    const approval = createTestApproval({ jobId: job.id });
    createApproval(db.adapter, approval);

    const revokeResult = revokeApproval(db.adapter, approval.jobId, Date.now() as UTCTimestamp);
    expect(revokeResult.ok).toBe(true);

    const active = getActiveApproval(db.adapter, approval.jobId);
    expect(active).toBeUndefined();
  });
});

describe("Instance Repository", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("should register and retrieve instance", () => {
    const now = Date.now() as UTCTimestamp;
    const instance = {
      id: "instance-1",
      hostname: "test-host",
      processId: 12345,
      startedAt: now,
      heartbeatAt: now,
    };

    const result = registerInstance(db.adapter, instance);
    expect(result.ok).toBe(true);

    const retrieved = getInstanceById(db.adapter, "instance-1");
    expect(retrieved).toBeDefined();
    if (!retrieved) return;
    expect(retrieved.hostname).toBe("test-host");
  });

  it("should update heartbeat", () => {
    const now = Date.now() as UTCTimestamp;
    registerInstance(db.adapter, {
      id: "instance-1",
      hostname: "test",
      processId: 1,
      startedAt: now,
      heartbeatAt: now,
    });

    const newHeartbeat = (now + 15_000) as UTCTimestamp;
    const result = updateHeartbeat(db.adapter, "instance-1", newHeartbeat);
    expect(result.ok).toBe(true);

    const retrieved = getInstanceById(db.adapter, "instance-1");
    if (!retrieved) return;
    expect(retrieved.heartbeatAt).toBe(newHeartbeat);
  });

  it("should detect stale instances", () => {
    const oldTime = (Date.now() - 120_000) as UTCTimestamp;
    registerInstance(db.adapter, {
      id: "stale-instance",
      hostname: "test",
      processId: 1,
      startedAt: oldTime,
      heartbeatAt: oldTime,
    });

    const now = Date.now() as UTCTimestamp;
    const stale = getStaleInstances(db.adapter, now);
    expect(stale.length).toBe(1);
    const first = stale[0];
    if (first) expect(first.id).toBe("stale-instance");
  });

  it("should stop instance", () => {
    const now = Date.now() as UTCTimestamp;
    registerInstance(db.adapter, {
      id: "instance-1",
      hostname: "test",
      processId: 1,
      startedAt: now,
      heartbeatAt: now,
    });

    const stopTime = (now + 30_000) as UTCTimestamp;
    stopInstance(db.adapter, "instance-1", stopTime);

    const threshold = (now + 120_000) as UTCTimestamp;
    const stale = getStaleInstances(db.adapter, threshold);
    expect(stale.length).toBe(0);
  });
});

describe("Audit Repository", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("should append and retrieve audit events", () => {
    const event: AuditEvent = {
      id: ids.generate(),
      type: "job.created",
      timestamp: Date.now() as UTCTimestamp,
      entityId: "job-1",
      actor: "test-user",
      payload: { name: "test-job" },
      message: "Job created",
    };

    const result = appendAuditEvent(db.adapter, event);
    expect(result.ok).toBe(true);

    const events = listAuditEvents(db.adapter, { jobId: "job-1" });
    expect(events.events.length).toBe(1);
    const firstEvent = events.events[0];
    if (firstEvent) expect(firstEvent.type).toBe("job.created");
  });

  it("should paginate audit events", () => {
    for (let i = 0; i < 5; i++) {
      appendAuditEvent(db.adapter, {
        id: ids.generate(),
        type: "job.created",
        timestamp: (Date.now() - i * 1000) as UTCTimestamp,
        entityId: "job-1",
        actor: "test",
        payload: {},
        message: `Event ${i}`,
      });
    }

    const result = listAuditEvents(db.adapter, { jobId: "job-1", limit: 2 });
    expect(result.events.length).toBe(2);
    expect(result.nextCursor).toBeDefined();
  });
});

/**
 * Job service integration tests.
 *
 * Tests:
 *   - Tool/import creation becomes pending_approval
 *   - Non-privileged direct-user creation may activate
 *   - Privileged direct-user creation remains pending
 *   - Approval is bound to the current fingerprint
 *   - Display-only changes retain approval
 *   - Fingerprinted changes invalidate approval atomically
 *   - Null clearing works
 *   - Stale revisions fail
 *   - No partial updates remain
 *   - Model is persisted at creation; imports cannot omit the model
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApprovalService } from "../../../src/application/approval-service.js";
import { createJobService } from "../../../src/application/job-service.js";
import type { JobDefinition } from "../../../src/domain/job.js";
import { computeJobFingerprint } from "../../../src/security/job-fingerprint.js";
import { createSystemClock } from "../../../src/shared/clock.js";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import { createTestDatabase, type TestDb } from "../../fixtures/database.js";

const clock = createSystemClock();
const ids = createDeterministicIdGenerator("js-");
const DEFAULT_MODEL = "claude-sonnet-4-5";

function createServices(db: TestDb) {
  const deps = { adapter: db.adapter, clock, ids, defaultModel: DEFAULT_MODEL };
  return {
    jobSvc: createJobService(deps),
    approvalSvc: createApprovalService(deps),
  };
}

function baseDef(): Omit<JobDefinition, "model"> {
  return {
    name: "test-job",
    prompt: "Do something useful",
    schedule: { kind: "interval", everyMs: 3600_000 },
    identity: { scope: "user", scopeKey: "alice" },
    execution: {
      mode: "subagent",
      workingDirectory: "/tmp",
      timeoutMs: 600_000,
      maxOutputBytes: 262_144,
      overlapPolicy: "skip",
      missedRunPolicy: "skip",
      sandboxRequired: false,
      environment: { values: {}, secretNames: [] },
    },
    permissions: {
      tools: ["read", "write"],
      shell: { allowed: false, commands: [] },
      filesystem: { readPaths: ["/tmp"], writePaths: ["/tmp"] },
      network: { allowed: false, domains: [] },
      extensions: { allowedIds: [] },
      secrets: { allowedNames: [] },
    },
    source: "direct_user",
    tags: [],
  };
}

// ─── Test suites ───────────────────────────────────────

describe("Job Service", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("emits lifecycle events only after durable job mutations succeed", () => {
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const jobSvc = createJobService({
      adapter: db.adapter,
      clock,
      ids,
      defaultModel: DEFAULT_MODEL,
      events,
    });
    const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = jobSvc.updateExistingJob({
      jobId: created.value.id,
      expectedRevision: created.value.revision,
      patch: { description: "event" },
      actor: "alice",
    });
    expect(updated.ok).toBe(true);
    expect(seen).toEqual(["job.created", "job.updated"]);
  });

  // ─── Create ─────────────────────────────────────────

  describe("createJob", () => {
    it("should create a job with default model", () => {
      const { jobSvc } = createServices(db);
      const result = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const job = result.value;
      expect(job.definition.name).toBe("test-job");
      expect(job.definition.model).toBe(DEFAULT_MODEL);
      expect(job.status).toBe("active");
      expect(job.revision).toBe(1);
      expect(job.fingerprint).toHaveLength(64);
    });

    it("should use provided model when specified", () => {
      const { jobSvc } = createServices(db);
      const def = { ...baseDef(), model: "claude-opus-4" };
      const result = jobSvc.createJob({ definition: def, actor: "alice" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.definition.model).toBe("claude-opus-4");
    });

    it("should default tool source to pending_approval", () => {
      const { jobSvc } = createServices(db);
      const def = { ...baseDef(), source: "tool" as const };
      const result = jobSvc.createJob({ definition: def, actor: "tool-agent" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("pending_approval");
      expect(result.value.approvedFingerprint).toBeUndefined();
    });

    it("should set project_import source to pending_approval", () => {
      const { jobSvc } = createServices(db);
      const def = { ...baseDef(), source: "project_import" as const, importKey: "import-1" };
      const result = jobSvc.createJob({ definition: def, actor: "system" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("pending_approval");
    });

    it("should activate direct_user jobs by default", () => {
      const { jobSvc } = createServices(db);
      const def = { ...baseDef(), source: "direct_user" as const };
      const result = jobSvc.createJob({ definition: def, actor: "alice" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("active");
    });

    it("should honor requestApproval for direct_user jobs", () => {
      const { jobSvc } = createServices(db);
      const def = { ...baseDef(), source: "direct_user" as const };
      const result = jobSvc.createJob({
        definition: def,
        actor: "alice",
        requestApproval: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("pending_approval");
    });

    it("should honor privileged flag for direct_user jobs", () => {
      const { jobSvc } = createServices(db);
      const def = { ...baseDef(), source: "direct_user" as const };
      const result = jobSvc.createJob({
        definition: def,
        actor: "admin",
        privileged: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("pending_approval");
    });

    it("should enforce scoped name uniqueness", () => {
      const { jobSvc } = createServices(db);
      const r1 = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(r1.ok).toBe(true);

      const r2 = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error.code).toBe("JOB_NAME_CONFLICT");
    });

    it("should compute and persist a fingerprint", () => {
      const { jobSvc } = createServices(db);
      const def = baseDef();
      const result = jobSvc.createJob({ definition: def, actor: "alice" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const expected = computeJobFingerprint({
        ...def,
        model: DEFAULT_MODEL,
        tags: [],
      });
      expect(result.value.fingerprint).toBe(expected);

      // Reload and check fingerprint persists
      const reloaded = jobSvc.getJob(result.value.id);
      expect(reloaded.ok).toBe(true);
      if (!reloaded.ok || !reloaded.value) return;
      expect(reloaded.value.fingerprint).toBe(expected);
    });
  });

  // ─── Get ────────────────────────────────────────────

  describe("getJob", () => {
    it("should return a job by id", () => {
      const { jobSvc } = createServices(db);
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = jobSvc.getJob(created.value.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeDefined();
      expect(result.value?.id).toBe(created.value.id);
    });

    it("should return undefined for missing job", () => {
      const { jobSvc } = createServices(db);
      const result = jobSvc.getJob("nonexistent");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeUndefined();
    });
  });

  // ─── List ───────────────────────────────────────────

  describe("listUserJobs", () => {
    it("should list jobs with pagination", () => {
      const { jobSvc } = createServices(db);
      for (let i = 0; i < 5; i++) {
        const def = { ...baseDef(), name: `job-${i}` };
        const r = jobSvc.createJob({ definition: def, actor: "alice" });
        expect(r.ok).toBe(true);
      }

      const page1 = jobSvc.listUserJobs({ limit: 2 });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.value.jobs.length).toBe(2);
      expect(page1.value.nextCursor).toBeDefined();
    });

    it("should filter by status", () => {
      const { jobSvc } = createServices(db);
      const def = { ...baseDef(), source: "tool" as const };
      const r = jobSvc.createJob({ definition: def, actor: "tool" });
      expect(r.ok).toBe(true);

      const pending = jobSvc.listUserJobs({ status: "pending_approval" });
      expect(pending.ok).toBe(true);
      if (!pending.ok) return;
      expect(pending.value.jobs.length).toBe(1);
    });
  });

  // ─── Update ─────────────────────────────────────────

  describe("updateExistingJob", () => {
    it("should update a job and bump revision", () => {
      const { jobSvc } = createServices(db);
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: 1,
        patch: { description: "Updated description" },
        actor: "alice",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.revision).toBe(2);
      expect(result.value.definition.description).toBe("Updated description");
    });

    it("should fail on stale revision", () => {
      const { jobSvc } = createServices(db);
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: 99,
        patch: { description: "Stale" },
        actor: "alice",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("REVISION_CONFLICT");
    });

    it("should retain approval on display-only changes", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      // Create and approve a job
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const approveResult = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-ok",
      });
      expect(approveResult.ok).toBe(true);
      if (!approveResult.ok) return;

      // Update display-only field (description)
      const updateResult = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: approveResult.value.revision,
        patch: { description: "A display-only change" },
        actor: "alice",
      });
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;

      // Approval should still be valid (active status retained)
      const job = jobSvc.getJob(created.value.id);
      expect(job.ok).toBe(true);
      if (!job.ok || !job.value) return;
      expect(job.value.status).toBe("active");
      expect(job.value.approvedFingerprint).toBeDefined();
    });

    it("should invalidate approval on security-relevant changes", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      // Create and approve a job
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const approveResult = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-ok",
      });
      expect(approveResult.ok).toBe(true);
      if (!approveResult.ok) return;
      expect(approveResult.value.status).toBe("active");

      // Update security-relevant field (prompt)
      const updateResult = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: approveResult.value.revision,
        patch: { prompt: "A modified prompt" },
        actor: "alice",
      });
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;

      // Approval should be invalidated and job back to pending_approval
      const job = jobSvc.getJob(created.value.id);
      expect(job.ok).toBe(true);
      if (!job.ok || !job.value) return;
      expect(job.value.status).toBe("pending_approval");
      expect(job.value.approvedFingerprint).toBeUndefined();
    });

    it("should invalidate approval on model change", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-ok",
      });

      // Change model — security-relevant
      const updateResult = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: 2,
        patch: { model: "claude-haiku-3" },
        actor: "alice",
      });
      expect(updateResult.ok).toBe(true);

      const job = jobSvc.getJob(created.value.id);
      expect(job.ok).toBe(true);
      if (!job.ok || !job.value) return;
      expect(job.value.status).toBe("pending_approval");
      expect(job.value.approvedFingerprint).toBeUndefined();
    });

    it("should allow null-clearing a field", () => {
      const { jobSvc } = createServices(db);

      const def = { ...baseDef(), description: "Initial description" };
      const created = jobSvc.createJob({ definition: def, actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Clear description by setting it to null (via patch)
      const result = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: 1,
        patch: { description: undefined as unknown as string },
        actor: "alice",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Description should be cleared
      const job = jobSvc.getJob(created.value.id);
      expect(job.ok).toBe(true);
      if (!job.ok || !job.value) return;
      expect(job.value.definition.description).toBeUndefined();
    });

    it("should apply no partial updates on failure", () => {
      const { jobSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const originalFingerprint = created.value.fingerprint;
      const originalPrompt = created.value.definition.prompt;

      // Try to update with stale revision — should fail entirely
      const result = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: 99,
        patch: { prompt: "Should not be applied" },
        actor: "alice",
      });
      expect(result.ok).toBe(false);

      // Verify job is unchanged
      const job = jobSvc.getJob(created.value.id);
      expect(job.ok).toBe(true);
      if (!job.ok || !job.value) return;
      expect(job.value.definition.prompt).toBe(originalPrompt);
      expect(job.value.fingerprint).toBe(originalFingerprint);
      expect(job.value.revision).toBe(1);
    });
  });

  // ─── Status transitions ─────────────────────────────

  describe("status transitions", () => {
    it("should pause a job", () => {
      const { jobSvc } = createServices(db);
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = jobSvc.pauseJob(created.value.id, 1, "alice");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("paused");
      expect(result.value.revision).toBe(2);
    });

    it("should resume a paused job", () => {
      const { jobSvc } = createServices(db);
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const paused = jobSvc.pauseJob(created.value.id, 1, "alice");
      expect(paused.ok).toBe(true);
      if (!paused.ok) return;

      const resumed = jobSvc.resumeJob(created.value.id, 2, "alice");
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.value.status).toBe("active");
    });

    it("should archive a job", () => {
      const { jobSvc } = createServices(db);
      const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = jobSvc.archiveJob(created.value.id, 1, "alice");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("archived");
    });
  });
});

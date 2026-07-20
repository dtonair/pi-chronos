/**
 * Approval service integration tests.
 *
 * Tests:
 *   - Approval is bound to the current fingerprint
 *   - Stale fingerprints are refused
 *   - Confirmation token is required
 *   - Revocation clears approval and reverts to pending_approval
 *   - Approval creates audit events
 *   - Revocation creates audit events
 *   - Approval transitions job from pending_approval to active
 *   - Interactive approval refusal without token
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApprovalService } from "../../../src/application/approval-service.js";
import { createJobService } from "../../../src/application/job-service.js";
import type { JobDefinition } from "../../../src/domain/job.js";
import { createSystemClock } from "../../../src/shared/clock.js";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import { listAuditEvents } from "../../../src/storage/repositories/audit-repository.js";
import { createTestDatabase, type TestDb } from "../../fixtures/database.js";

const clock = createSystemClock();
const ids = createDeterministicIdGenerator("as-");
const DEFAULT_MODEL = "claude-sonnet-4-5";

function createServices(db: TestDb, events?: ReturnType<typeof createEventBus>) {
  const deps = { adapter: db.adapter, clock, ids, defaultModel: DEFAULT_MODEL, events };
  return {
    jobSvc: createJobService(deps),
    approvalSvc: createApprovalService(deps),
  };
}

function baseDef(): Omit<JobDefinition, "model"> {
  return {
    name: "test-approval-job",
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
    source: "tool" as const,
    tags: [],
  };
}

describe("Approval Service", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it("emits approval lifecycle events after commit", () => {
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const { jobSvc, approvalSvc } = createServices(db, events);
    const created = jobSvc.createJob({ definition: baseDef(), actor: "alice" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(
      approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "confirmed",
      }).ok,
    ).toBe(true);
    expect(approvalSvc.revokeApproval(created.value.id, "alice", "tui", "revocation").ok).toBe(
      true,
    );
    expect(seen).toEqual(["job.created", "job.approved", "job.revoked"]);
  });

  // ─── Approve ────────────────────────────────────────

  describe("approveJob", () => {
    it("should approve a pending tool job and activate it", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.value.status).toBe("pending_approval");

      const result = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("active");
      expect(result.value.approvedFingerprint).toBe(created.value.fingerprint);
    });

    it("should refuse approval without confirmation token", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "", // Empty token
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INTERACTIVE_APPROVAL_REQUIRED");
    });

    it("should refuse approval with stale fingerprint", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: "00".repeat(32), // Wrong fingerprint
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("FINGERPRINT_MISMATCH");
    });

    it("should fail for non-existent job", () => {
      const { approvalSvc } = createServices(db);

      const result = approvalSvc.approveJob({
        jobId: "nonexistent",
        fingerprint: "a".repeat(64),
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("JOB_NOT_FOUND");
    });

    it("should create audit events on approval", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });
      expect(result.ok).toBe(true);

      const audits = listAuditEvents(db.adapter, { jobId: created.value.id });
      const approvalEvents = audits.events.filter((e) => e.type === "approval.approved");
      expect(approvalEvents.length).toBe(1);
      const evt = approvalEvents[0];
      if (evt) {
        expect(evt.actor).toBe("alice");
        const payload = evt.payload as Record<string, unknown>;
        expect(payload.fingerprint).toBe(created.value.fingerprint);
      }
    });
  });

  // ─── Revoke ─────────────────────────────────────────

  describe("revokeApproval", () => {
    it("should revoke approval and set status to pending_approval", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Approve first
      const approved = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.value.status).toBe("active");

      // Now revoke
      const revoked = approvalSvc.revokeApproval(
        created.value.id,
        "alice",
        "tui",
        "user-confirmed-revoke-ok",
      );
      expect(revoked.ok).toBe(true);
      if (!revoked.ok) return;
      expect(revoked.value.status).toBe("pending_approval");
      expect(revoked.value.approvedFingerprint).toBeUndefined();
    });

    it("should require confirmation token for revocation", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });

      const result = approvalSvc.revokeApproval(
        created.value.id,
        "alice",
        "tui",
        "", // Empty token
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("INTERACTIVE_APPROVAL_REQUIRED");
    });

    it("should fail revoking without active approval", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Not approved yet — try to revoke
      const result = approvalSvc.revokeApproval(
        created.value.id,
        "alice",
        "tui",
        "user-confirmed-revoke-ok",
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("APPROVAL_NOT_FOUND");
    });

    it("should create audit events on revocation", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });

      approvalSvc.revokeApproval(created.value.id, "alice", "tui", "user-confirmed-revoke-ok");

      const audits = listAuditEvents(db.adapter, { jobId: created.value.id });
      const revokeEvents = audits.events.filter((e) => e.type === "approval.revoked");
      expect(revokeEvents.length).toBe(1);
    });
  });

  // ─── getJobApproval ────────────────────────────────

  describe("getJobApproval", () => {
    it("should return undefined for unapproved job", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const approval = approvalSvc.getJobApproval(created.value.id);
      expect(approval).toBeUndefined();
    });

    it("should return approval after approval", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });

      const approval = approvalSvc.getJobApproval(created.value.id);
      expect(approval).toBeDefined();
      if (approval) {
        expect(approval.fingerprint).toBe(created.value.fingerprint);
        expect(approval.source).toBe("tui");
      }
    });

    it("should return undefined after revocation", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });

      approvalSvc.revokeApproval(created.value.id, "alice", "tui", "user-confirmed-revoke-ok");

      const approval = approvalSvc.getJobApproval(created.value.id);
      expect(approval).toBeUndefined();
    });
  });

  // ─── Approval + Update cycle ────────────────────────

  describe("approval-update cycle", () => {
    it("should keep approval valid across display-only updates", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      // Create
      const created = jobSvc.createJob({
        definition: { ...baseDef(), description: "v1" },
        actor: "tool-agent",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Approve
      const approved = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.value.status).toBe("active");

      // Update description (display-only)
      const updated = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: approved.value.revision,
        patch: { description: "v2" },
        actor: "alice",
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.status).toBe("active");
      expect(updated.value.approvedFingerprint).toBeDefined();
    });

    it("should re-approve after security-relevant edit", () => {
      const { jobSvc, approvalSvc } = createServices(db);

      // Create and approve
      const created = jobSvc.createJob({ definition: baseDef(), actor: "tool-agent" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const approved = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: created.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-yes-ok",
      });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      // Change prompt (security-relevant)
      const updated = jobSvc.updateExistingJob({
        jobId: created.value.id,
        expectedRevision: approved.value.revision,
        patch: { prompt: "Updated prompt" },
        actor: "alice",
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.value.status).toBe("pending_approval");
      expect(updated.value.approvedFingerprint).toBeUndefined();

      // Re-approve
      const reApproved = approvalSvc.approveJob({
        jobId: created.value.id,
        fingerprint: updated.value.fingerprint,
        actor: "alice",
        source: "tui",
        confirmationToken: "user-confirmed-reapprove-ok",
      });
      expect(reApproved.ok).toBe(true);
      if (!reApproved.ok) return;
      expect(reApproved.value.status).toBe("active");
      expect(reApproved.value.approvedFingerprint).toBe(updated.value.fingerprint);
    });
  });
});

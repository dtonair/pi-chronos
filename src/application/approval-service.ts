/**
 * Approval application service.
 *
 * Handles approval and revocation with:
 *   - User-confirmation token requirement (Pi adapter supplies this)
 *   - Fingerprint-bound approvals: stale fingerprints are refused
 *   - Immutable audit events for every approval/revocation
 *   - Atomic approval invalidation when jobs are modified
 */
import type { ApprovalDecision, ApprovalSource } from "../domain/approval.js";
import type { AuditEvent } from "../domain/audit.js";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Job, UTCTimestamp } from "../domain/job.js";
import { fingerprintsMatch } from "../security/job-fingerprint.js";
import type { Clock, EventSink, IdGenerator } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import type { DatabaseAdapter } from "../storage/database.js";
import {
  createApproval as createApprovalRepo,
  getActiveApproval,
  revokeApproval as revokeApprovalRepo,
} from "../storage/repositories/approval-repository.js";
import { appendAuditEvent } from "../storage/repositories/audit-repository.js";
import { getJobById } from "../storage/repositories/job-repository.js";
import { inTransaction } from "../storage/transaction.js";

// ─── Approval service interface ───────────────────────

export interface ApprovalServiceDeps {
  adapter: DatabaseAdapter;
  clock: Clock;
  ids: IdGenerator;
  events?: EventSink;
}

export function createApprovalService(deps: ApprovalServiceDeps) {
  const { adapter, clock, ids } = deps;

  function emit(type: "job.approved" | "job.revoked", job: Job): void {
    deps.events?.emit({
      type,
      timestamp: clock.now(),
      entityId: job.id,
      payload: { status: job.status },
    });
  }

  function makeAuditEvent(
    type: AuditEvent["type"],
    job: Job,
    actor: string,
    payload: Record<string, unknown> = {},
  ): AuditEvent {
    return {
      id: ids.generate(),
      type,
      timestamp: clock.now(),
      entityId: job.id,
      actor,
      payload,
      message: `Job "${job.definition.name}": ${type}`,
    };
  }

  /**
   * Approve a job. Requires a user-confirmation token supplied by the Pi adapter.
   *
   * The confirmation token ensures the user explicitly confirmed the action
   * through TUI or RPC. The approval is bound to the current job fingerprint.
   */
  function approveJob(decision: ApprovalDecision): Result<Job> {
    const result = inTransaction(adapter, () => {
      // Load current job state
      const jobResult = getJobById(adapter, decision.jobId);
      if (!jobResult.ok) return jobResult;
      const job = jobResult.value;
      if (job === undefined) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.JOB_NOT_FOUND,
            message: `Job not found: ${decision.jobId}`,
            entity: decision.jobId,
          }),
        );
      }

      // Require confirmation token
      if (!decision.confirmationToken || decision.confirmationToken.length < 8) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.INTERACTIVE_APPROVAL_REQUIRED,
            message: "Approval requires a user confirmation token from TUI or RPC interaction.",
            entity: decision.jobId,
          }),
        );
      }

      // Validate the fingerprint matches the current job state
      if (!fingerprintsMatch(decision.fingerprint, job.fingerprint)) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.FINGERPRINT_MISMATCH,
            message: "Fingerprint mismatch: the job has been modified. Re-review before approving.",
            entity: decision.jobId,
            meta: {
              requested: decision.fingerprint,
              current: job.fingerprint,
            },
          }),
        );
      }

      const now = clock.now();

      // Keep a single active approval record while retaining prior decisions
      // as immutable, revoked history.
      adapter.run(
        "UPDATE job_approvals SET revoked_at = ? WHERE job_id = ? AND revoked_at IS NULL",
        new Date(now).toISOString(),
        decision.jobId,
      );

      // Create the approval record
      const approvalResult = createApprovalRepo(adapter, {
        id: ids.generate(),
        jobId: decision.jobId,
        fingerprint: decision.fingerprint,
        approvedBy: decision.actor,
        approvedAt: now,
        source: decision.source,
      });

      if (!approvalResult.ok) return approvalResult;

      // Update the job atomically: set approvedFingerprint and activate if pending
      updateJobApprovalFields(
        adapter,
        decision.jobId,
        job.revision,
        decision.fingerprint,
        now,
        decision.actor,
      );

      // Record audit event
      appendAuditEvent(
        adapter,
        makeAuditEvent("approval.approved", job, decision.actor, {
          fingerprint: decision.fingerprint,
          source: decision.source,
        }),
      );

      // Re-fetch the updated job
      const refreshed = getJobById(adapter, decision.jobId);
      if (!refreshed.ok || !refreshed.value) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.INTERNAL_ERROR,
            message: "Approval succeeded but failed to reload job state",
            entity: decision.jobId,
          }),
        );
      }

      return ok(refreshed.value);
    });
    if (result.ok) emit("job.approved", result.value);
    return result;
  }

  /**
   * Revoke approval for a job. Requires a confirmation token.
   * Returns the job reverted to pending_approval status.
   */
  function revokeApproval(
    jobId: string,
    actor: string,
    source: ApprovalSource,
    confirmationToken: string,
  ): Result<Job> {
    const result = inTransaction(adapter, () => {
      const jobResult = getJobById(adapter, jobId);
      if (!jobResult.ok) return jobResult;
      const job = jobResult.value;
      if (job === undefined) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.JOB_NOT_FOUND,
            message: `Job not found: ${jobId}`,
            entity: jobId,
          }),
        );
      }

      // Require confirmation token
      if (!confirmationToken || confirmationToken.length < 8) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.INTERACTIVE_APPROVAL_REQUIRED,
            message: "Revocation requires a user confirmation token from TUI or RPC interaction.",
            entity: jobId,
          }),
        );
      }

      // Check that there is actually an active approval to revoke
      const activeApproval = getActiveApproval(adapter, jobId);
      if (activeApproval === undefined) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.APPROVAL_NOT_FOUND,
            message: `No active approval found for job "${job.definition.name}"`,
            entity: jobId,
          }),
        );
      }

      const now = clock.now();

      // Revoke in the approval repository
      const revokeResult = revokeApprovalRepo(adapter, jobId, now);
      if (!revokeResult.ok) return revokeResult;

      // Update job: clear approvedFingerprint and set status to pending_approval
      updateJobApprovalFields(adapter, jobId, job.revision, undefined, now, actor);

      // Record audit
      appendAuditEvent(
        adapter,
        makeAuditEvent("approval.revoked", job, actor, {
          source,
          fingerprint: activeApproval.fingerprint,
        }),
      );

      // Re-fetch the updated job
      const refreshed = getJobById(adapter, jobId);
      if (!refreshed.ok || !refreshed.value) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.INTERNAL_ERROR,
            message: "Revocation succeeded but failed to reload job state",
            entity: jobId,
          }),
        );
      }

      return ok(refreshed.value);
    });
    if (result.ok) emit("job.revoked", result.value);
    return result;
  }

  /**
   * Get the current active (non-revoked) approval for a job.
   */
  function getJobApproval(jobId: string) {
    return getActiveApproval(adapter, jobId);
  }

  return {
    approveJob,
    revokeApproval,
    getJobApproval,
  };
}

// ─── Internal helpers ─────────────────────────────────

/**
 * Directly update a job's approval-related fields (approved_fingerprint, approved_at, status).
 * Uses revision compare-and-set for safety.
 */
function updateJobApprovalFields(
  adapter: DatabaseAdapter,
  jobId: string,
  expectedRevision: number,
  approvedFingerprint: string | undefined,
  approvedAt: UTCTimestamp | undefined,
  actor: string,
): void {
  const now = new Date(approvedAt ?? Date.now()).toISOString();
  const newRevision = expectedRevision + 1;

  // Keep the denormalized dispatch gate in sync with the status. A pending job
  // must be excluded by the due query; an approved job must be dispatchable.
  const newStatus = approvedFingerprint !== undefined ? "active" : "pending_approval";
  const approvalRequired = approvedFingerprint !== undefined ? 0 : 1;

  const result = adapter.run(
    `UPDATE jobs SET
      approved_fingerprint = ?,
      approval_required = ?,
      status = ?,
      updated_at = ?,
      updated_by = ?,
      revision = ?
     WHERE id = ? AND revision = ?`,
    approvedFingerprint ?? null,
    approvalRequired,
    newStatus,
    now,
    actor,
    newRevision,
    jobId,
    expectedRevision,
  );

  if (result.changes === 0) {
    throw new ChronosError({
      code: ChronosErrorCode.REVISION_CONFLICT,
      message: `Revision conflict for job ${jobId}: concurrent modification detected`,
      entity: jobId,
    });
  }
}

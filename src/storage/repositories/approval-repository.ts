/**
 * Approval repository with revocation support and fingerprint-based lookup.
 */

import type { JobApproval } from "../../domain/approval.js";
import { ChronosError, ChronosErrorCode } from "../../domain/errors.js";
import type { UTCTimestamp } from "../../domain/job.js";
import type { Result } from "../../shared/result.js";
import { err, ok } from "../../shared/result.js";
import { type ApprovalRow, decodeApprovalRow, encodeApprovalRow } from "../codecs.js";
import type { DatabaseAdapter } from "../database.js";

// ─── Create approval ──────────────────────────

export function createApproval(
  adapter: DatabaseAdapter,
  approval: JobApproval,
): Result<JobApproval> {
  const row = encodeApprovalRow(approval);
  adapter.run(
    `INSERT INTO job_approvals (id, job_id, fingerprint, approved_by, approved_at, revoked_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.job_id,
    row.fingerprint,
    row.approved_by,
    row.approved_at,
    row.revoked_at,
    row.source,
  );
  return ok(approval);
}

// ─── Get active (non-revoked) approval for a job ──

export function getActiveApproval(
  adapter: DatabaseAdapter,
  jobId: string,
): JobApproval | undefined {
  const row = adapter.get<ApprovalRow>(
    "SELECT * FROM job_approvals WHERE job_id = ? AND revoked_at IS NULL ORDER BY approved_at DESC LIMIT 1",
    jobId,
  );
  if (row === undefined) return undefined;
  return decodeApprovalRow(row);
}

// ─── Get approval by ID ────────────────────────

export function getApprovalById(adapter: DatabaseAdapter, id: string): JobApproval | undefined {
  const row = adapter.get<ApprovalRow>("SELECT * FROM job_approvals WHERE id = ?", id);
  if (row === undefined) return undefined;
  return decodeApprovalRow(row);
}

// ─── Revoke approval ──────────────────────────

export function revokeApproval(
  adapter: DatabaseAdapter,
  jobId: string,
  revokedAt: UTCTimestamp,
): Result<void> {
  const result = adapter.run(
    "UPDATE job_approvals SET revoked_at = ? WHERE job_id = ? AND revoked_at IS NULL",
    new Date(revokedAt).toISOString(),
    jobId,
  );

  if (result.changes === 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.APPROVAL_NOT_FOUND,
        message: `No active approval found for job ${jobId}`,
        entity: jobId,
      }),
    );
  }
  return ok(undefined);
}

// ─── List approvals for a job ──────────────────

export function listApprovals(adapter: DatabaseAdapter, jobId: string): JobApproval[] {
  const rows = adapter.all<ApprovalRow>(
    "SELECT * FROM job_approvals WHERE job_id = ? ORDER BY approved_at DESC",
    jobId,
  );
  return rows.map((row) => decodeApprovalRow(row));
}

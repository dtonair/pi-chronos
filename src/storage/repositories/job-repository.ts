/**
 * Job repository with parameterized SQL, revision compare-and-set,
 * and paginated list queries.
 */

import { ChronosError, ChronosErrorCode } from "../../domain/errors.js";
import type { Job, JobScope, JobStatus, UTCTimestamp } from "../../domain/job.js";
import { computeJobFingerprint } from "../../security/job-fingerprint.js";
import type { Result } from "../../shared/result.js";
import { err, ok } from "../../shared/result.js";
import { decodeJobRow, encodeJobRow, type JobRow } from "../codecs.js";
import type { DatabaseAdapter } from "../database.js";
import { inImmediateTransaction, inTransaction } from "../transaction.js";

// ─── Create ──────────────────────────────────

export function createJob(adapter: DatabaseAdapter, job: Job): Result<Job> {
  return inTransaction(adapter, () => {
    // Check scoped name uniqueness
    const existing = adapter.get<{ id: string }>(
      `SELECT id FROM jobs WHERE scope = ? AND scope_key = ? AND normalized_name = ?`,
      job.definition.identity.scope,
      job.definition.identity.scopeKey,
      job.definition.name.toLowerCase(),
    );
    if (existing !== undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.JOB_NAME_CONFLICT,
          message: `A job named "${job.definition.name}" already exists in this scope`,
          entity: job.definition.name,
        }),
      );
    }

    const row = encodeJobRow(job);
    adapter.run(
      `INSERT INTO jobs (id, schema_version, name, normalized_name, description, prompt, tags_json,
        status, scope, scope_key, source, import_key,
        schedule_json, execution_json, permissions_json,
        approval_required, approved_fingerprint,
        next_run_at, last_scheduled_at, last_run_at, last_success_at,
        consecutive_failures, diagnostic_code, diagnostic_message,
        created_at, created_by, updated_at, updated_by, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.schema_version,
      row.name,
      row.normalized_name,
      row.description,
      row.prompt,
      row.tags_json,
      row.status,
      row.scope,
      row.scope_key,
      row.source,
      row.import_key,
      row.schedule_json,
      row.execution_json,
      row.permissions_json,
      row.approval_required,
      row.approved_fingerprint,
      row.next_run_at,
      row.last_scheduled_at,
      row.last_run_at,
      row.last_success_at,
      row.consecutive_failures,
      row.diagnostic_code,
      row.diagnostic_message,
      row.created_at,
      row.created_by,
      row.updated_at,
      row.updated_by,
      row.revision,
    );
    return ok(job);
  });
}

// ─── Get by ID ──────────────────────────────

export function getJobById(adapter: DatabaseAdapter, id: string): Result<Job | undefined> {
  const row = adapter.get<JobRow>("SELECT * FROM jobs WHERE id = ?", id);
  if (row === undefined) return ok(undefined);
  const result = decodeJobRow(row);
  if (!result.ok) return result;
  const job = result.value;
  hydrateApprovalTimestamp(adapter, job);
  // Compute current fingerprint from definition (not stored in DB)
  job.fingerprint = computeJobFingerprint(job.definition);
  return ok(job);
}

// ─── List with keyset pagination ────────────

export interface ListJobsOptions {
  scope?: JobScope;
  scopeKey?: string;
  status?: JobStatus;
  cursor?: string;
  limit?: number;
}

export interface ListJobsResult {
  jobs: Job[];
  nextCursor?: string;
}

export function listJobs(
  adapter: DatabaseAdapter,
  options: ListJobsOptions,
): Result<ListJobsResult> {
  const limit = options.limit ?? 20;
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (options.scope !== undefined) {
    clauses.push("scope = ?");
    params.push(options.scope);
  }
  if (options.scopeKey !== undefined) {
    clauses.push("scope_key = ?");
    params.push(options.scopeKey);
  }
  if (options.status !== undefined) {
    clauses.push("status = ?");
    params.push(options.status);
  }
  if (options.cursor !== undefined) {
    clauses.push("id > ?");
    params.push(options.cursor);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = adapter.all<JobRow>(
    `SELECT * FROM jobs ${whereClause} ORDER BY id ASC LIMIT ?`,
    ...params,
    limit + 1,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const jobs: Job[] = [];
  for (const row of pageRows) {
    const result = decodeJobRow(row);
    if (!result.ok) return result;
    const job = result.value;
    hydrateApprovalTimestamp(adapter, job);
    job.fingerprint = computeJobFingerprint(job.definition);
    jobs.push(job);
  }

  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.id : undefined;
  return ok({ jobs, nextCursor });
}

// ─── Update with revision compare-and-set ───

export function updateJob(
  adapter: DatabaseAdapter,
  id: string,
  expectedRevision: number,
  updater: (job: Job) => Result<Job>,
): Result<Job> {
  return inTransaction(adapter, () => {
    const existing = adapter.get<JobRow>("SELECT * FROM jobs WHERE id = ?", id);
    if (existing === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.JOB_NOT_FOUND,
          message: `Job not found: ${id}`,
          entity: id,
        }),
      );
    }

    if (existing.revision !== expectedRevision) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.REVISION_CONFLICT,
          message: `Revision conflict for job ${id}: expected ${expectedRevision}, got ${existing.revision}`,
          entity: id,
          meta: { expected: expectedRevision, actual: existing.revision },
        }),
      );
    }

    const decoded = decodeJobRow(existing);
    if (!decoded.ok) return decoded;

    const updated = updater(decoded.value);
    if (!updated.ok) return updated;

    const row = encodeJobRow(updated.value);
    const newRevision = existing.revision + 1;
    row.revision = newRevision;

    const updateResult = adapter.run(
      `UPDATE jobs SET
        name = ?, normalized_name = ?, description = ?, prompt = ?, tags_json = ?,
        status = ?, scope = ?, scope_key = ?, source = ?, import_key = ?,
        schedule_json = ?, execution_json = ?, permissions_json = ?,
        approval_required = ?, approved_fingerprint = ?,
        next_run_at = ?, last_scheduled_at = ?, last_run_at = ?, last_success_at = ?,
        consecutive_failures = ?, diagnostic_code = ?, diagnostic_message = ?,
        updated_at = ?, updated_by = ?, revision = ?
       WHERE id = ? AND revision = ?`,
      row.name,
      row.normalized_name,
      row.description,
      row.prompt,
      row.tags_json,
      row.status,
      row.scope,
      row.scope_key,
      row.source,
      row.import_key,
      row.schedule_json,
      row.execution_json,
      row.permissions_json,
      row.approval_required,
      row.approved_fingerprint,
      row.next_run_at,
      row.last_scheduled_at,
      row.last_run_at,
      row.last_success_at,
      row.consecutive_failures,
      row.diagnostic_code,
      row.diagnostic_message,
      row.updated_at,
      row.updated_by,
      newRevision,
      id,
      expectedRevision,
    );

    if (updateResult.changes === 0) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.REVISION_CONFLICT,
          message: `Revision conflict for job ${id}: concurrent modification detected`,
          entity: id,
        }),
      );
    }

    const finalJob = { ...updated.value, revision: newRevision };
    hydrateApprovalTimestamp(adapter, finalJob);
    return ok(finalJob);
  });
}

/** Permanently remove a job after an expected-revision check. Audit rows retain
 * the deletion record; related runs and approvals follow their foreign keys. */
export function deleteJob(
  adapter: DatabaseAdapter,
  id: string,
  expectedRevision: number,
): Result<void> {
  return inImmediateTransaction(adapter, () => {
    const existing = adapter.get<{ revision: number }>(
      "SELECT revision FROM jobs WHERE id = ?",
      id,
    );
    if (existing === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.JOB_NOT_FOUND,
          message: `Job not found: ${id}`,
          entity: id,
        }),
      );
    }
    if (existing.revision !== expectedRevision) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.REVISION_CONFLICT,
          message: `Revision conflict for job ${id}`,
          entity: id,
          meta: { expected: expectedRevision, actual: existing.revision },
        }),
      );
    }
    const deleted = adapter.run(
      "DELETE FROM jobs WHERE id = ? AND revision = ?",
      id,
      expectedRevision,
    );
    return deleted.changes === 1
      ? ok(undefined)
      : err(
          new ChronosError({
            code: ChronosErrorCode.REVISION_CONFLICT,
            message: `Job ${id} changed before deletion`,
            entity: id,
          }),
        );
  });
}

// ─── Direct status transitions ──────────────

export function transitionJobStatus(
  adapter: DatabaseAdapter,
  id: string,
  expectedRevision: number,
  newStatus: JobStatus,
  updatedBy: string,
  updatedAt: UTCTimestamp,
  diagnostic?: { code: string; message: string },
): Result<Job> {
  return updateJob(adapter, id, expectedRevision, (job) => {
    job.status = newStatus;
    job.updatedAt = updatedAt;
    job.updatedBy = updatedBy;
    if (diagnostic !== undefined) {
      job.diagnosticCode = diagnostic.code;
      job.diagnosticMessage = diagnostic.message;
    }
    return ok(job);
  });
}

// ─── Update next_run_at (scheduler service) ──

export function updateJobNextRun(
  adapter: DatabaseAdapter,
  id: string,
  nextRunAt: UTCTimestamp | null,
  updatedAt: UTCTimestamp = Date.now() as UTCTimestamp,
): Result<void> {
  adapter.run(
    "UPDATE jobs SET next_run_at = ?, last_scheduled_at = ? WHERE id = ?",
    nextRunAt !== null ? new Date(nextRunAt).toISOString() : null,
    new Date(updatedAt).toISOString(),
    id,
  );
  return ok(undefined);
}

// ─── Update counters (post-run) ─────────────

export function updateJobRunCounters(
  adapter: DatabaseAdapter,
  id: string,
  success: boolean,
  runTimestamp: UTCTimestamp,
): Result<void> {
  if (success) {
    adapter.run(
      `UPDATE jobs SET
        consecutive_failures = 0,
        last_success_at = ?,
        last_run_at = ?,
        updated_at = ?
       WHERE id = ?`,
      new Date(runTimestamp).toISOString(),
      new Date(runTimestamp).toISOString(),
      new Date(runTimestamp).toISOString(),
      id,
    );
  } else {
    adapter.run(
      `UPDATE jobs SET
        consecutive_failures = consecutive_failures + 1,
        last_run_at = ?,
        updated_at = ?
       WHERE id = ?`,
      new Date(runTimestamp).toISOString(),
      new Date(runTimestamp).toISOString(),
      id,
    );
  }
  return ok(undefined);
}

// ─── Get due jobs (for dispatcher) ──────────

export function getDueJobs(adapter: DatabaseAdapter, now: UTCTimestamp, limit: number): Job[] {
  const rows = adapter.all<JobRow>(
    `SELECT * FROM jobs
     WHERE next_run_at IS NOT NULL
       AND next_run_at <= ?
       AND status = 'active'
       AND approval_required = 0
     ORDER BY next_run_at ASC
     LIMIT ?`,
    new Date(now).toISOString(),
    limit,
  );

  const jobs: Job[] = [];
  for (const row of rows) {
    const result = decodeJobRow(row);
    if (result.ok) {
      const job = result.value;
      hydrateApprovalTimestamp(adapter, job);
      job.fingerprint = computeJobFingerprint(job.definition);
      jobs.push(job);
    }
    // Malformed rows are silently skipped; they will remain as corrupt diagnostics
  }
  return jobs;
}

function hydrateApprovalTimestamp(adapter: DatabaseAdapter, job: Job): void {
  if (job.approvedFingerprint === undefined) {
    job.approvedAt = undefined;
    return;
  }
  const row = adapter.get<{ approved_at: string }>(
    `SELECT approved_at FROM job_approvals
     WHERE job_id = ? AND fingerprint = ? AND revoked_at IS NULL
     ORDER BY approved_at DESC LIMIT 1`,
    job.id,
    job.approvedFingerprint,
  );
  const timestamp = row === undefined ? undefined : Date.parse(row.approved_at);
  job.approvedAt =
    timestamp === undefined || Number.isNaN(timestamp) ? undefined : (timestamp as UTCTimestamp);
}

// ─── Count jobs by status ──────────────────

export function countJobsByStatus(adapter: DatabaseAdapter, status: JobStatus): number {
  const row = adapter.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM jobs WHERE status = ?",
    status,
  );
  return row?.count ?? 0;
}

export function countActiveJobs(adapter: DatabaseAdapter): number {
  return countJobsByStatus(adapter, "active");
}

export function countPendingApprovalJobs(adapter: DatabaseAdapter): number {
  return countJobsByStatus(adapter, "pending_approval");
}

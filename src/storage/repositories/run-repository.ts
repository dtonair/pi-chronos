/**
 * Run repository with occurrence uniqueness, terminal immutability,
 * atomic claim helpers, and paginated history queries.
 */

import { ChronosError, ChronosErrorCode } from "../../domain/errors.js";
import type { UTCTimestamp } from "../../domain/job.js";
import type { Run, RunStatus } from "../../domain/run.js";
import { isTerminalRunStatus } from "../../domain/run.js";
import type { Result } from "../../shared/result.js";
import { err, ok } from "../../shared/result.js";
import { decodeRunRow, encodeRunRow, type RunRow } from "../codecs.js";
import type { DatabaseAdapter } from "../database.js";
import { inImmediateTransaction } from "../transaction.js";

// ─── Create (with occurrence uniqueness check) ──

export function createRun(adapter: DatabaseAdapter, run: Run): Result<Run> {
  return inImmediateTransaction(adapter, () => {
    // Check occurrence uniqueness
    const existing = adapter.get<{ id: string }>(
      "SELECT id FROM job_runs WHERE job_id = ? AND occurrence_key = ?",
      run.jobId,
      run.occurrenceKey,
    );
    if (existing !== undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.DUPLICATE_OCCURRENCE,
          message: `Run already exists for job ${run.jobId} occurrence ${run.occurrenceKey}`,
          entity: run.jobId,
          meta: { occurrenceKey: run.occurrenceKey, existingRunId: existing.id },
        }),
      );
    }

    const row = encodeRunRow(run);
    adapter.run(
      `INSERT INTO job_runs (
        id, job_id, occurrence_key, trigger, scheduled_at, queued_at,
        claimed_at, started_at, finished_at, status, attempt,
        executor_id, lease_expires_at, parent_run_id,
        output_summary, output_location, output_truncated,
        error_code, error_message, error_details, metadata_json,
        duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.job_id,
      row.occurrence_key,
      row.trigger,
      row.scheduled_at,
      row.queued_at,
      row.claimed_at,
      row.started_at,
      row.finished_at,
      row.status,
      row.attempt,
      row.executor_id,
      row.lease_expires_at,
      row.parent_run_id,
      row.output_summary,
      row.output_location,
      row.output_truncated,
      row.error_code,
      row.error_message,
      row.error_details,
      row.metadata_json,
      row.duration_ms,
      row.created_at,
    );
    return ok(run);
  });
}

// ─── Get by ID ──────────────────────────────

export function getRunById(adapter: DatabaseAdapter, id: string): Result<Run | undefined> {
  const row = adapter.get<RunRow>("SELECT * FROM job_runs WHERE id = ?", id);
  if (row === undefined) return ok(undefined);
  const result = decodeRunRow(row);
  if (!result.ok) return result;
  return ok(result.value);
}

// ─── Atomic claim: queued → claimed ─────────

export function claimRun(
  adapter: DatabaseAdapter,
  runId: string,
  executorId: string,
  leaseDeadline: UTCTimestamp,
  now: UTCTimestamp,
): Result<Run> {
  return inImmediateTransaction(adapter, () => {
    const existing = adapter.get<RunRow>(
      "SELECT * FROM job_runs WHERE id = ? AND status = 'queued'",
      runId,
    );
    if (existing === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.RUN_NOT_FOUND,
          message: `Run not found or not in queued state: ${runId}`,
          entity: runId,
        }),
      );
    }

    // Atomic claim: only update if still queued
    const updateResult = adapter.run(
      `UPDATE job_runs
       SET status = 'claimed', executor_id = ?, lease_expires_at = ?, claimed_at = ?
       WHERE id = ? AND status = 'queued'`,
      executorId,
      new Date(leaseDeadline).toISOString(),
      new Date(now).toISOString(),
      runId,
    );

    if (updateResult.changes === 0) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.RUN_NOT_FOUND,
          message: `Run ${runId} was claimed by another executor`,
          entity: runId,
        }),
      );
    }

    const row = adapter.get<RunRow>("SELECT * FROM job_runs WHERE id = ?", runId);
    if (row === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.INTERNAL_ERROR,
          message: `Run disappeared after claim: ${runId}`,
        }),
      );
    }

    const decoded = decodeRunRow(row);
    if (!decoded.ok) return decoded;
    return ok(decoded.value);
  });
}

// ─── Transition run status (with ownership check) ──

export function transitionRunStatus(
  adapter: DatabaseAdapter,
  runId: string,
  executorId: string | undefined,
  newStatus: RunStatus,
  timestamp: UTCTimestamp,
): Result<Run> {
  // Terminal immutability check
  const existing = adapter.get<RunRow>("SELECT * FROM job_runs WHERE id = ?", runId);
  if (existing === undefined) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.RUN_NOT_FOUND,
        message: `Run not found: ${runId}`,
        entity: runId,
      }),
    );
  }

  if (isTerminalRunStatus(existing.status as RunStatus)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.RUN_ALREADY_TERMINAL,
        message: `Run ${runId} is already in terminal state: ${existing.status}`,
        entity: runId,
        meta: { currentStatus: existing.status },
      }),
    );
  }

  // Ownership check: if the run has an executor, only that executor can transition
  if (
    existing.executor_id !== null &&
    executorId !== undefined &&
    existing.executor_id !== executorId
  ) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.RUN_NOT_OWNED,
        message: `Run ${runId} is owned by ${existing.executor_id}, not ${executorId}`,
        entity: runId,
      }),
    );
  }

  // Build update fields based on target status
  const updates: string[] = ["status = ?"];
  const params: (string | number | null)[] = [newStatus];

  if (newStatus === "running") {
    updates.push("started_at = ?");
    params.push(new Date(timestamp).toISOString());
  }

  if (isTerminalRunStatus(newStatus as RunStatus)) {
    updates.push("finished_at = ?");
    params.push(new Date(timestamp).toISOString());
    updates.push("lease_expires_at = NULL");
    updates.push("executor_id = NULL");
  }

  params.push(runId);
  adapter.run(`UPDATE job_runs SET ${updates.join(", ")} WHERE id = ?`, ...params);

  const row = adapter.get<RunRow>("SELECT * FROM job_runs WHERE id = ?", runId);
  if (row === undefined) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.INTERNAL_ERROR,
        message: `Run disappeared after transition: ${runId}`,
      }),
    );
  }

  const decoded = decodeRunRow(row);
  if (!decoded.ok) return decoded;
  return ok(decoded.value);
}

// ─── Renew lease ────────────────────────────

export function renewRunLease(
  adapter: DatabaseAdapter,
  runId: string,
  executorId: string,
  leaseDeadline: UTCTimestamp,
): Result<void> {
  const result = adapter.run(
    `UPDATE job_runs
     SET lease_expires_at = ?
     WHERE id = ? AND executor_id = ? AND status IN ('claimed', 'running')`,
    new Date(leaseDeadline).toISOString(),
    runId,
    executorId,
  );

  if (result.changes === 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.RUN_LEASE_EXPIRED,
        message: `Cannot renew lease for run ${runId}: not owned by ${executorId} or not in claimable state`,
        entity: runId,
      }),
    );
  }
  return ok(undefined);
}

// ─── Get runs by status for recovery ────────

export function getRunsNeedingRecovery(
  adapter: DatabaseAdapter,
  staleThreshold: UTCTimestamp,
): Run[] {
  const rows = adapter.all<RunRow>(
    `SELECT r.* FROM job_runs r
     WHERE r.status IN ('claimed', 'running')
       AND r.lease_expires_at IS NOT NULL
       AND r.lease_expires_at <= ?
     ORDER BY r.created_at ASC`,
    new Date(staleThreshold).toISOString(),
  );

  const runs: Run[] = [];
  for (const row of rows) {
    const result = decodeRunRow(row);
    if (result.ok) runs.push(result.value);
  }
  return runs;
}

// ─── History with keyset pagination ─────────

export interface RunHistoryOptions {
  jobId?: string;
  status?: RunStatus;
  cursor?: string;
  limit?: number;
}

export interface RunHistoryResult {
  runs: Run[];
  nextCursor?: string;
}

export function listRuns(
  adapter: DatabaseAdapter,
  options: RunHistoryOptions,
): Result<RunHistoryResult> {
  const limit = options.limit ?? 20;
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (options.jobId !== undefined) {
    clauses.push("job_id = ?");
    params.push(options.jobId);
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
  const rows = adapter.all<RunRow>(
    `SELECT * FROM job_runs ${whereClause} ORDER BY created_at DESC, id ASC LIMIT ?`,
    ...params,
    limit + 1,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const runs: Run[] = [];
  for (const row of pageRows) {
    const result = decodeRunRow(row);
    if (!result.ok) return result;
    runs.push(result.value);
  }

  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.id : undefined;
  return ok({ runs, nextCursor });
}

// ─── Count runs by status ──────────────────

export function countRunsByStatus(adapter: DatabaseAdapter, status: RunStatus): number {
  const row = adapter.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM job_runs WHERE status = ?",
    status,
  );
  return row?.count ?? 0;
}

export function countRunningRuns(adapter: DatabaseAdapter): number {
  return countRunsByStatus(adapter, "running");
}

export function countStaleLeases(adapter: DatabaseAdapter, now: UTCTimestamp): number {
  const row = adapter.get<{ count: number }>(
    `SELECT COUNT(*) as count FROM job_runs
     WHERE status IN ('claimed', 'running')
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at <= ?`,
    new Date(now).toISOString(),
  );
  return row?.count ?? 0;
}

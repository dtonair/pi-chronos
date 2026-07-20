/** Transactional scheduler mutations. */
import { ChronosError, ChronosErrorCode } from "../../domain/errors.js";
import type { Job, UTCTimestamp } from "../../domain/job.js";
import type { Run } from "../../domain/run.js";
import type { CronCalculator } from "../../scheduler/cron.js";
import { calculateNextRun } from "../../scheduler/next-run.js";
import { err, ok, type Result } from "../../shared/result.js";
import { decodeJobRow, encodeRunRow, type JobRow, type RunRow } from "../codecs.js";
import type { DatabaseAdapter } from "../database.js";
import { inImmediateTransaction } from "../transaction.js";

export interface DispatchMutation {
  job: Job;
  run: Run;
  nextRunAt: UTCTimestamp | null;
  disableJob?: boolean;
}

export type DispatchResult =
  | { kind: "queued"; run: Run }
  | { kind: "skipped"; run: Run }
  | { kind: "overlap"; run: Run }
  | { kind: "already_dispatched" };

/**
 * Insert the run and advance the job in one BEGIN IMMEDIATE transaction.
 * The job row is rechecked inside the transaction so a stale due query cannot
 * dispatch a paused, revoked, or edited job.
 */
export function dispatchOccurrence(
  adapter: DatabaseAdapter,
  mutation: DispatchMutation,
  now: UTCTimestamp,
  overlap: boolean,
): Result<DispatchResult> {
  return inImmediateTransaction<DispatchResult>(adapter, () => {
    const current = adapter.get<JobRow>("SELECT * FROM jobs WHERE id = ?", mutation.job.id);
    if (current === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.JOB_NOT_FOUND,
          message: "Job not found",
          entity: mutation.job.id,
        }),
      );
    }
    // Check the durable occurrence key before mutable job-state guards. A
    // second scheduler may observe the row after the first owner advanced or
    // disabled the job; duplicate dispatch is still a successful no-op.
    const duplicate = adapter.get<{ id: string }>(
      "SELECT id FROM job_runs WHERE job_id = ? AND occurrence_key = ?",
      mutation.job.id,
      mutation.run.occurrenceKey,
    );
    if (duplicate !== undefined) return ok({ kind: "already_dispatched" });

    if (current.revision !== mutation.job.revision) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.REVISION_CONFLICT,
          message: "Job changed after the due query; dispatch must be recalculated",
          entity: mutation.job.id,
          meta: { expected: mutation.job.revision, actual: current.revision },
        }),
      );
    }
    if (current.status !== "active" || current.approval_required !== 0) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.APPROVAL_REQUIRED,
          message: "Job is not active or approved",
          entity: mutation.job.id,
        }),
      );
    }
    if (current.next_run_at === null || Date.parse(current.next_run_at) > now) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.SCHEDULER_STOPPED,
          message: "Job is no longer due",
          entity: mutation.job.id,
        }),
      );
    }

    const run: Run = overlap
      ? {
          ...mutation.run,
          status: "skipped",
          skipReason: "OVERLAP_SKIPPED",
          timing: { ...mutation.run.timing, finishedAt: now },
        }
      : mutation.run;
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
    if (
      !advanceJob(
        adapter,
        mutation.job.id,
        mutation.nextRunAt,
        mutation.disableJob === true,
        now,
        current.revision,
      )
    )
      return err(
        new ChronosError({
          code: ChronosErrorCode.REVISION_CONFLICT,
          message: "Job changed while dispatching its occurrence",
          entity: mutation.job.id,
        }),
      );
    return ok({ kind: overlap ? "overlap" : run.status === "skipped" ? "skipped" : "queued", run });
  });
}

function advanceJob(
  adapter: DatabaseAdapter,
  jobId: string,
  nextRunAt: UTCTimestamp | null,
  disable: boolean,
  now: UTCTimestamp,
  expectedRevision?: number,
): boolean {
  const revisionClause = expectedRevision === undefined ? "" : " AND revision = ?";
  const params: (string | number | null)[] = [
    nextRunAt === null ? null : new Date(nextRunAt).toISOString(),
    new Date(now).toISOString(),
    disable ? 1 : 0,
    new Date(now).toISOString(),
    jobId,
  ];
  if (expectedRevision !== undefined) params.push(expectedRevision);
  const result = adapter.run(
    `UPDATE jobs SET next_run_at = ?, last_scheduled_at = ?,
       status = CASE WHEN ? = 1 THEN 'disabled' ELSE status END,
       updated_at = ?, revision = revision + 1
     WHERE id = ?${revisionClause}`,
    ...params,
  );
  return result.changes === 1;
}

/** Update a job's due time without creating a run (missed=skip). */
export function skipMissedOccurrences(
  adapter: DatabaseAdapter,
  jobId: string,
  nextRunAt: UTCTimestamp | null,
  now: UTCTimestamp,
  disable = false,
  expectedRevision?: number,
): Result<void> {
  return inImmediateTransaction<void>(adapter, () => {
    if (!advanceJob(adapter, jobId, nextRunAt, disable, now, expectedRevision)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.REVISION_CONFLICT,
          message: "Job changed while advancing missed occurrences",
          entity: jobId,
        }),
      );
    }
    return ok(undefined);
  });
}

/** Return queued runs ordered by durable creation order. */
export function listQueuedRuns(adapter: DatabaseAdapter, limit: number): RunRow[] {
  return adapter.all<RunRow>(
    "SELECT * FROM job_runs WHERE status = 'queued' ORDER BY queued_at ASC, id ASC LIMIT ?",
    Math.max(0, Math.floor(limit)),
  );
}

/** Populate schedules created before the scheduler was running. */
export function initializeNullSchedules(
  adapter: DatabaseAdapter,
  now: UTCTimestamp,
  cronCalc: CronCalculator,
): void {
  const rows = adapter.all<JobRow>(
    "SELECT * FROM jobs WHERE next_run_at IS NULL AND status = 'active' AND approval_required = 0",
  );
  for (const row of rows) {
    const decoded = decodeJobRow(row);
    if (!decoded.ok) continue;
    const next = calculateNextRun(decoded.value.definition.schedule, now, false, cronCalc);
    if (!next.ok || next.value.kind === "none") continue;
    const at =
      next.value.kind === "once"
        ? next.value.occurrence.runAtMs
        : next.value.kind === "interval"
          ? next.value.occurrence.occurrenceMs
          : next.value.occurrence.utcMs;
    adapter.run(
      "UPDATE jobs SET next_run_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND next_run_at IS NULL",
      new Date(at).toISOString(),
      new Date(now).toISOString(),
      row.id,
    );
  }
}

import type { Job, UTCTimestamp } from "../domain/job.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { getDueJobs } from "../storage/repositories/job-repository.js";

/** Read due work in bounded pages; SQLite remains the source of truth. */
export function queryDueJobs(adapter: DatabaseAdapter, now: UTCTimestamp, batchSize = 100): Job[] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) return [];
  return getDueJobs(adapter, now, batchSize);
}

/** Return the earliest active approved due time, if one exists. */
export function queryNextDueAt(adapter: DatabaseAdapter): UTCTimestamp | null {
  const row = adapter.get<{ next_run_at: string | null }>(
    `SELECT next_run_at FROM jobs
     WHERE next_run_at IS NOT NULL AND status = 'active' AND approval_required = 0
     ORDER BY next_run_at ASC LIMIT 1`,
  );
  if (!row?.next_run_at) return null;
  const value = Date.parse(row.next_run_at);
  return Number.isNaN(value) ? null : (value as UTCTimestamp);
}

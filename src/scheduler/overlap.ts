import type { DatabaseAdapter } from "../storage/database.js";

/** A queued, claimed, or running run makes a job overlap with a new occurrence. */
export function hasActiveOverlap(adapter: DatabaseAdapter, jobId: string): boolean {
  const row = adapter.get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM job_runs
     WHERE job_id = ? AND status IN ('queued', 'claimed', 'running')`,
    jobId,
  );
  return (row?.count ?? 0) > 0;
}

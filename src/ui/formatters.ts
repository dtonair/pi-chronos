import type { Job } from "../domain/job.js";
import type { Run } from "../domain/run.js";
export function formatJob(job: Job): string {
  return `${job.definition.name} [${job.status}] next=${job.nextRunAt ? new Date(job.nextRunAt).toISOString() : "none"}`;
}
export function formatRun(run: Run): string {
  const category = run.failureCode ? ` category=${run.failureCode}` : "";
  const completion = run.output?.completionSummary
    ? ` completion=${run.output.completionSummary}`
    : "";
  return `${run.id} ${run.status} ${new Date(run.occurrenceAt).toISOString()}${category}${completion}`;
}

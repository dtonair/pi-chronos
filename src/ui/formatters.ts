import type { Job } from "../domain/job.js";
import type { Run } from "../domain/run.js";
import { renderJobTable } from "./jobs-view.js";
import { formatRun as formatHistoryRun } from "./run-history-view.js";

/** Compatibility formatter retained under the original export name. */
export function formatJob(job: Job): string {
  return renderJobTable([job], { width: 200 }).at(-1) ?? job.definition.name;
}

export function formatRun(run: Run): string {
  return formatHistoryRun(run);
}

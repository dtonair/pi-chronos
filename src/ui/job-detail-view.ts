import { Text } from "@earendil-works/pi-tui";
import type { Job } from "../domain/job.js";
export function renderJobDetail(job: Job): string {
  return JSON.stringify(job, null, 2);
}

/** Documented Pi TUI component for a job detail view. */
export function createJobDetailView(job: Job): Text {
  return new Text(renderJobDetail(job), 0, 0);
}

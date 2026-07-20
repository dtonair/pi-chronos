import { Text } from "@earendil-works/pi-tui";
import type { Job } from "../domain/job.js";
import { formatJob } from "./formatters.js";
export function renderJobs(jobs: readonly Job[]): string[] {
  return jobs.map(formatJob);
}

/** Documented Pi TUI component for a compact, paginated job page. */
export function createJobsView(jobs: readonly Job[]): Text {
  return new Text(renderJobs(jobs).join("\n"), 0, 0);
}

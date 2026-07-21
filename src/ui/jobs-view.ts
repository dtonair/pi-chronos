import { Text } from "@earendil-works/pi-tui";
import type { Job } from "../domain/job.js";
import { formatRelativeTime } from "./format/relative-time.js";
import { displayWidth, pad, truncate } from "./layout.js";
import { type JobListItem, mapJobToListItem, sortJobItems } from "./view-models.js";

export interface JobsRenderOptions {
  width?: number;
  now?: number;
}

export function toJobListItems(jobs: readonly Job[], now = Date.now()): JobListItem[] {
  return jobs.map((job) => mapJobToListItem(job, now));
}

export function renderJobTable(
  jobs: readonly Job[] | readonly JobListItem[],
  options: JobsRenderOptions = {},
): string[] {
  const width = Math.max(20, options.width ?? 80);
  const now = options.now ?? Date.now();
  const first = jobs[0];
  const items =
    first !== undefined && "definition" in first
      ? toJobListItems(jobs as readonly Job[], now)
      : [...(jobs as readonly JobListItem[])];
  const sorted = sortJobItems(items);
  if (sorted.length === 0) return ["No Chronos jobs."];

  if (width < 60) return renderNarrow(sorted, width, now);

  const stateWidth = 5;
  const scheduleWidth = width >= 100 ? 22 : 18;
  const activityWidth = width >= 100 ? 24 : 18;
  const nameWidth = Math.max(12, width - stateWidth - scheduleWidth - activityWidth - 9);
  const header = `${pad("STATE", stateWidth)} ${pad("NAME", nameWidth)} ${pad("SCHEDULE", scheduleWidth)} ${truncate("NEXT/LAST", activityWidth)}`;
  const separator = `${"─".repeat(Math.min(width, displayWidth(header)))}`;
  const lines = [header, separator];
  for (const item of sorted) {
    const activity =
      item.state === "active" && item.nextRunAt !== null
        ? formatRelativeTime(item.nextRunAt, now)
        : item.activityLabel;
    lines.push(
      `${pad(item.stateSymbol, stateWidth)} ${pad(item.name, nameWidth)} ${pad(item.scheduleLabel, scheduleWidth)} ${truncate(activity, activityWidth)}`,
    );
  }
  return lines.map((line) => truncate(line, width));
}

function renderNarrow(items: readonly JobListItem[], width: number, now: number): string[] {
  const lines: string[] = ["JOBS"];
  const nameWidth = Math.max(10, width - 8);
  for (const item of items) {
    const activity =
      item.state === "active" && item.nextRunAt !== null
        ? formatRelativeTime(item.nextRunAt, now)
        : item.activityLabel;
    lines.push(
      `${item.stateSymbol} ${truncate(item.name, nameWidth)}  ${truncate(stateText(item.state), Math.max(6, width - nameWidth - 5))}`,
    );
    lines.push(`  ${truncate(`${item.scheduleLabel} · ${activity}`, width - 2)}`);
  }
  return lines.map((line) => truncate(line, width));
}

function stateText(state: JobListItem["state"]): string {
  switch (state) {
    case "active":
      return "active";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "approval":
      return "approval";
    case "failed":
      return "failed";
    case "disabled":
      return "disabled";
    case "invalid":
      return "invalid";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/** Compatibility wrapper retained under the original export name. */
export function renderJobs(
  jobs: readonly Job[] | readonly JobListItem[],
  options: JobsRenderOptions = {},
): string[] {
  return renderJobTable(jobs, options);
}

export function createJobsView(
  jobs: readonly Job[] | readonly JobListItem[],
  options: JobsRenderOptions = {},
): Text {
  return new Text(renderJobTable(jobs, options).join("\n"), 0, 0);
}

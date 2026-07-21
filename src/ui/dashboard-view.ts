import { Text } from "@earendil-works/pi-tui";
import type { SchedulerHealth } from "../api/result.js";
import { formatRelativeTime } from "./format/relative-time.js";
import { truncate } from "./layout.js";
import { formatStatus, isDegraded } from "./status.js";
import { type JobListItem, sortJobItems } from "./view-models.js";

export interface DashboardState {
  health?: SchedulerHealth;
  jobs: readonly JobListItem[];
  hasMoreJobs?: boolean;
}

export interface DashboardRenderOptions {
  width?: number;
  now?: number;
  maxJobs?: number;
}

export function renderCompactDashboard(
  state: DashboardState,
  options: DashboardRenderOptions = {},
): string {
  const width = Math.max(24, options.width ?? 80);
  const now = options.now ?? Date.now();
  const maxJobs = Math.max(1, options.maxJobs ?? 5);
  const sorted = sortJobItems(state.jobs);
  const visible = sorted.slice(0, maxJobs);
  const lines = [state.health ? dashboardStatus(state.health, width) : "CHRONOS ● STARTING"];
  if (visible.length === 0) {
    lines.push("No Chronos jobs · /chronos to open workspace");
  } else {
    const activityWidth = Math.min(18, Math.max(8, Math.floor(width * 0.35)));
    const nameWidth = Math.max(10, width - activityWidth - 5);
    for (const item of visible) {
      let activity = item.activityLabel;
      if (item.state === "active" && item.nextRunAt !== null)
        activity = formatRelativeTime(item.nextRunAt, now);
      lines.push(
        `${item.stateSymbol} ${padDashboard(item.name, nameWidth)} ${truncate(activity, activityWidth)}`,
      );
    }
  }
  const remaining = sorted.length - visible.length;
  if (remaining > 0 || state.hasMoreJobs) {
    const count = remaining > 0 ? `${remaining} more jobs` : "more jobs";
    lines.push(`… ${count} · /chronos to expand`);
  }
  return lines.map((line) => truncate(line, width)).join("\n");
}

function dashboardStatus(health: SchedulerHealth, width: number): string {
  const full = formatStatus(health);
  if (full.length <= width) return full;
  if (isDegraded(health))
    return `CHRONOS ! DEGRADED · DB ${health.databaseState} · Timer ${health.timerState}`;
  return `CHRONOS ● ACTIVE · ${health.activeJobs} active · ${health.runningRuns} running`;
}

function padDashboard(value: string, width: number): string {
  const text = truncate(value, width);
  return text + " ".repeat(Math.max(0, width - [...text].length));
}

export function createCompactDashboardView(
  state: DashboardState,
  options: DashboardRenderOptions = {},
): Text {
  return new Text(renderCompactDashboard(state, options), 0, 0);
}

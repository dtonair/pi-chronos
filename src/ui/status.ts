import { Text } from "@earendil-works/pi-tui";
import type { SchedulerHealth } from "../api/result.js";
export function formatStatus(health: SchedulerHealth): string {
  return `Chronos ${health.databaseState}; timer=${health.timerState}; queue=${health.queueDepth}; children=${health.activeChildren}`;
}

/** Documented Pi TUI footer/status component. */
export function createStatusView(health: SchedulerHealth): Text {
  return new Text(formatStatus(health), 0, 0);
}

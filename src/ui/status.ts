import { Text } from "@earendil-works/pi-tui";
import type { SchedulerHealth } from "../api/result.js";
import { SYMBOLS } from "./symbols.js";

export function isDegraded(health: SchedulerHealth): boolean {
  return (
    health.databaseState !== "ready" ||
    health.timerState === "stopped" ||
    health.staleLeases > 0 ||
    health.enforcement.toolAndPathPolicy !== "active" ||
    health.enforcement.osSandbox === "unavailable" ||
    health.lastSchedulerError !== undefined ||
    health.lastObservabilityError !== undefined
  );
}

export function formatStatus(health: SchedulerHealth): string {
  if (!isDegraded(health)) {
    return `${"CHRONOS"} ${SYMBOLS.active} ACTIVE   Active ${health.activeJobs}   Running ${health.runningRuns}   Queue ${health.queueDepth}   Approval ${health.pendingApprovalJobs}`;
  }
  const problems: string[] = [`DB ${health.databaseState}`, `Timer ${health.timerState}`];
  if (health.staleLeases > 0) problems.push(`Stale leases ${health.staleLeases}`);
  if (health.enforcement.toolAndPathPolicy !== "active") problems.push("Policy inactive");
  if (health.enforcement.osSandbox === "unavailable") problems.push("Sandbox unavailable");
  if (health.lastSchedulerError) problems.push("Scheduler error");
  if (health.lastObservabilityError) problems.push("Observability error");
  return `CHRONOS ${SYMBOLS.degraded} DEGRADED   ${problems.join("   ")}`;
}

export function createStatusView(health: SchedulerHealth): Text {
  return new Text(formatStatus(health), 0, 0);
}

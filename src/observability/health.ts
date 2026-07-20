import type { SchedulerHealth } from "../api/result.js";

export function createHealthSnapshot(initial?: Partial<SchedulerHealth>) {
  let value: SchedulerHealth = {
    databaseState: "closed",
    timerState: "stopped",
    queueDepth: 0,
    activeChildren: 0,
    staleLeases: 0,
    activeJobs: 0,
    pendingApprovalJobs: 0,
    runningRuns: 0,
    enforcement: { toolAndPathPolicy: "inactive", osSandbox: "disabled" },
    ...initial,
  };
  return {
    update(patch: Partial<SchedulerHealth>): void {
      value = { ...value, ...patch, enforcement: { ...value.enforcement, ...patch.enforcement } };
    },
    get(): SchedulerHealth {
      return structuredClone(value);
    },
  };
}

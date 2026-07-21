import type { SchedulerHealth } from "../api/result.js";
import type { Job, JobStatus } from "../domain/job.js";
import type { Run } from "../domain/run.js";
import { formatSchedule } from "./format/schedule.js";
import { SYMBOLS } from "./symbols.js";

export type JobDisplayState =
  | "active"
  | "running"
  | "paused"
  | "approval"
  | "failed"
  | "disabled"
  | "invalid";

export interface JobListItem {
  id: string;
  name: string;
  state: JobDisplayState;
  stateSymbol: string;
  scheduleLabel: string;
  nextRunAt: number | null;
  lastRunAt: number | null;
  activityLabel: string;
  attention?: string;
}

export interface JobDetailViewModel extends JobListItem {
  description?: string;
  prompt: string;
  model: string;
  workingDirectory: string;
  timeoutMs: number;
  maxOutputBytes: number;
  overlapPolicy: string;
  missedRunPolicy: string;
  sandboxRequired: boolean;
  timezone?: string;
  scheduleKind: string;
  scheduleExpression?: string;
  failureCount: number;
  diagnostic?: string;
  fingerprint: string;
  approved: boolean;
  permissions: Job["definition"]["permissions"];
}

export interface RunHistoryItem {
  id: string;
  jobId: string;
  status: Run["status"];
  occurrenceAt: number;
  trigger: Run["trigger"];
  attempt: number;
  durationMs: number | null;
  summary: string;
  skipReason?: string;
}

export interface ChronosWorkspaceState {
  mode: "compact" | "jobs" | "job-detail" | "history" | "health" | "approval";
  health?: SchedulerHealth;
  jobs: JobListItem[];
  selectedJob?: JobDetailViewModel;
  runs: RunHistoryItem[];
  approvalLines: string[];
  lastUpdatedAt?: number;
  hasMoreJobs?: boolean;
  notification?: { message: string; severity: "info" | "warning" | "error" };
}

export function createInitialWorkspaceState(): ChronosWorkspaceState {
  return { mode: "compact", jobs: [], runs: [], approvalLines: [] };
}

export function mapJobToListItem(job: Job, now = Date.now()): JobListItem {
  const state = displayState(job.status, job.consecutiveFailures, job.diagnosticMessage);
  return {
    id: job.id,
    name: job.definition.name,
    state,
    stateSymbol: symbolForJobState(state),
    scheduleLabel: formatSchedule(job.definition.schedule, now),
    nextRunAt: job.nextRunAt,
    lastRunAt: job.lastRunAt ?? null,
    activityLabel: activityForJob(job, now),
    attention: attentionForJob(job),
  };
}

export function mapJobToDetail(job: Job, now = Date.now()): JobDetailViewModel {
  const item = mapJobToListItem(job, now);
  const schedule = job.definition.schedule;
  return {
    ...item,
    description: job.definition.description,
    prompt: job.definition.prompt,
    model: job.definition.model,
    workingDirectory: job.definition.execution.workingDirectory,
    timeoutMs: job.definition.execution.timeoutMs,
    maxOutputBytes: job.definition.execution.maxOutputBytes,
    overlapPolicy: job.definition.execution.overlapPolicy,
    missedRunPolicy: job.definition.execution.missedRunPolicy,
    sandboxRequired: job.definition.execution.sandboxRequired,
    timezone:
      schedule.kind === "cron"
        ? schedule.timezone
        : schedule.kind === "once"
          ? schedule.timezone
          : undefined,
    scheduleKind: schedule.kind,
    scheduleExpression:
      schedule.kind === "cron"
        ? schedule.expression
        : schedule.kind === "once"
          ? schedule.runAt
          : undefined,
    failureCount: job.consecutiveFailures,
    diagnostic: job.diagnosticMessage ?? job.diagnosticCode,
    fingerprint: job.fingerprint,
    approved: job.approvedFingerprint !== undefined,
    permissions: {
      ...job.definition.permissions,
      secrets: {
        allowedNames: [
          ...new Set([
            ...job.definition.permissions.secrets.allowedNames,
            ...job.definition.execution.environment.secretNames,
          ]),
        ],
      },
    },
  };
}

export function mapRunToHistoryItem(run: Run): RunHistoryItem {
  const finished = run.timing.finishedAt;
  const started = run.timing.startedAt ?? run.timing.queuedAt;
  return {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    occurrenceAt: run.occurrenceAt,
    trigger: run.trigger,
    attempt: run.attempt,
    durationMs: finished === undefined ? null : Math.max(0, finished - started),
    summary: run.output?.summary ?? run.failureCode ?? run.skipReason ?? "no output",
    skipReason: run.skipReason,
  };
}

export function sortJobItems(items: readonly JobListItem[]): JobListItem[] {
  return [...items].sort((a, b) => {
    const priority = priorityForState(a.state) - priorityForState(b.state);
    if (priority !== 0) return priority;
    if (a.state === "active" && b.state === "active") {
      const aNext = a.nextRunAt ?? Number.POSITIVE_INFINITY;
      const bNext = b.nextRunAt ?? Number.POSITIVE_INFINITY;
      if (aNext !== bNext) return aNext - bNext;
    }
    const name = a.name.localeCompare(b.name);
    return name !== 0 ? name : a.id.localeCompare(b.id);
  });
}

function displayState(status: JobStatus, failures: number, diagnostic?: string): JobDisplayState {
  if (status === "pending_approval") return "approval";
  if (status === "invalid") return "invalid";
  if (status === "disabled" || status === "archived" || status === "draft") return "disabled";
  if (status === "paused") return "paused";
  if (failures > 0 || diagnostic !== undefined) return "failed";
  return "active";
}

function symbolForJobState(state: JobDisplayState): string {
  switch (state) {
    case "active":
      return SYMBOLS.active;
    case "running":
      return SYMBOLS.running;
    case "paused":
      return SYMBOLS.paused;
    case "approval":
      return SYMBOLS.approval;
    case "failed":
      return SYMBOLS.failed;
    case "disabled":
    case "invalid":
      return SYMBOLS.disabled;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function priorityForState(state: JobDisplayState): number {
  switch (state) {
    case "running":
      return 0;
    case "failed":
    case "invalid":
    case "approval":
      return 1;
    case "active":
      return 2;
    case "paused":
      return 3;
    case "disabled":
      return 4;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function activityForJob(job: Job, now: number): string {
  if (job.status === "pending_approval") return "approval";
  if (job.status === "paused") return "paused";
  if (job.status === "disabled" || job.status === "archived") return job.status;
  if (job.consecutiveFailures > 0) return `failed ${job.consecutiveFailures}x`;
  if (job.nextRunAt !== null) return `next ${formatSchedule(job.definition.schedule, now)}`;
  return "active";
}

function attentionForJob(job: Job): string | undefined {
  if (job.diagnosticMessage) return job.diagnosticMessage;
  if (job.consecutiveFailures > 0) return `${job.consecutiveFailures} consecutive failures`;
  if (job.status === "pending_approval") return "approval required";
  return undefined;
}

function symbolForStatus(status: Run["status"]): string {
  switch (status) {
    case "succeeded":
      return SYMBOLS.succeeded;
    case "failed":
    case "timed_out":
    case "abandoned":
      return SYMBOLS.failed;
    case "cancelled":
    case "skipped":
      return SYMBOLS.cancelled;
    case "running":
    case "claimed":
      return SYMBOLS.running;
    case "queued":
      return SYMBOLS.approval;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

export function runStatusSymbol(status: Run["status"]): string {
  return symbolForStatus(status);
}

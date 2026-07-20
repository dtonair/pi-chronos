import type { ChronosError, ChronosErrorCode } from "../domain/errors.js";

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginationInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationInfo;
}

export const SchedulerAction = {
  PREVIEW: "preview",
  CREATE: "create",
  GET: "get",
  LIST: "list",
  UPDATE: "update",
  PAUSE: "pause",
  RESUME: "resume",
  ARCHIVE: "archive",
  DELETE: "delete",
  RUN_NOW: "run_now",
  CANCEL_RUN: "cancel_run",
  HISTORY: "history",
  APPROVE: "approve",
  REVOKE_APPROVAL: "revoke_approval",
  IMPORT: "import",
  HEALTH: "health",
} as const;

export type SchedulerAction = (typeof SchedulerAction)[keyof typeof SchedulerAction];

export interface SchedulerWarning {
  code: string;
  message: string;
}

export interface SchedulerErrorPayload {
  code: ChronosErrorCode;
  message: string;
  details?: unknown;
}

export interface SchedulerOkResult<T = unknown> {
  ok: true;
  data?: T;
  presentation?: string;
  warnings?: SchedulerWarning[];
}

export interface SchedulerErrorResult {
  ok: false;
  presentation?: string;
  warnings?: SchedulerWarning[];
  error: SchedulerErrorPayload;
}

export type SchedulerResult<T = unknown> = SchedulerOkResult<T> | SchedulerErrorResult;

export function toSchedulerError(error: ChronosError): SchedulerErrorResult {
  const details =
    error.entity === undefined && Object.keys(error.meta).length === 0
      ? undefined
      : { entity: error.entity, ...error.meta };
  return {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export interface JobSummary {
  id: string;
  name: string;
  scope: string;
  scopeKey: string;
  status: string;
  source: string;
  scheduleKind: string;
  nextRunAt: string | null;
  consecutiveFailures: number;
  approved: boolean;
}

export interface RunSummary {
  id: string;
  jobId: string;
  status: string;
  scheduledAt: string;
  finishedAt?: string;
  summary?: string;
  exitCode?: number | null;
}

export interface SchedulerHealth {
  databaseState: "closed" | "ready" | "failed";
  migrationVersion?: number;
  timerState: "stopped" | "armed" | "waking";
  instanceId?: string;
  heartbeatAt?: string;
  queueDepth: number;
  activeChildren: number;
  staleLeases: number;
  activeJobs: number;
  pendingApprovalJobs: number;
  runningRuns: number;
  metrics?: {
    wakes: number;
    dispatches: number;
    queuedRuns: number;
    succeeded: number;
    failed: number;
    skipped: number;
    abandoned: number;
    policyDenials: number;
  };
  lastSchedulerError?: SchedulerErrorPayload;
  lastObservabilityError?: { message: string; timestamp: string };
  enforcement: {
    toolAndPathPolicy: "active" | "inactive";
    osSandbox: "active-tool-subprocess" | "unavailable" | "disabled";
  };
}

export interface SchedulePreview {
  normalizedSchedule: import("../domain/job.js").JobSchedule;
  nextOccurrences: string[];
}

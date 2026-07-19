import type { ChronosErrorCode } from "../domain/errors.js";

// ─── Pagination ───────────────────────

/** Keyset pagination via opaque cursor. */
export interface PaginationParams {
  /** Opaque cursor from a previous page. */
  cursor?: string;
  /** Max items per page (bounded at 100). */
  limit?: number;
}

export interface PaginationInfo {
  /** Cursor for the next page, or null if last page. */
  nextCursor: string | null;
  /** Whether there are more pages. */
  hasMore: boolean;
  /** Total items across all pages (optional, may be expensive). */
  total?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationInfo;
}

// ─── Scheduler Tool Actions ───────────

export const SchedulerAction = {
  LIST_JOBS: "list_jobs",
  GET_JOB: "get_job",
  CREATE_JOB: "create_job",
  UPDATE_JOB: "update_job",
  PAUSE_JOB: "pause_job",
  RESUME_JOB: "resume_job",
  ARCHIVE_JOB: "archive_job",
  DELETE_JOB: "delete_job",
  RUN_NOW: "run_now",
  CANCEL_RUN: "cancel_run",
  GET_RUN_HISTORY: "get_run_history",
  GET_RUN: "get_run",
  APPROVE_JOB: "approve_job",
  REVOKE_APPROVAL: "revoke_approval",
  PREVIEW_SCHEDULE: "preview_schedule",
  IMPORT_JOBS: "import_jobs",
  STATUS: "status",
} as const;

export type SchedulerAction = (typeof SchedulerAction)[keyof typeof SchedulerAction];

// ─── Scheduler Tool Input ─────────────

export interface SchedulerToolInput {
  action: SchedulerAction;
  [key: string]: unknown;
}

// ─── Scheduler Result ────────────────

export interface SchedulerErrorResult {
  ok: false;
  code: ChronosErrorCode;
  message: string;
  entity?: string;
  meta?: Record<string, unknown>;
}

export interface SchedulerOkResult<T = unknown> {
  ok: true;
  data: T;
}

export type SchedulerResult<T = unknown> = SchedulerOkResult<T> | SchedulerErrorResult;

// ─── Job Summary (for list views) ─────

export interface JobSummary {
  id: string;
  name: string;
  scope: string;
  status: string;
  source: string;
  scheduleType: string;
  nextRunAt: string | null;
  successCount: number;
  failureCount: number;
  approved: boolean;
}

// ─── Run Summary (for history views) ──

export interface RunSummary {
  id: string;
  jobId: string;
  status: string;
  occurrenceAt: string;
  finishedAt?: string;
  summary?: string;
  exitCode?: number | null;
}

// ─── Health / Status ──────────────────

export interface SchedulerStatus {
  ok: boolean;
  instanceId?: string;
  schedulerAlive: boolean;
  activeJobs: number;
  queuedRuns: number;
  runningRuns: number;
  lastWake?: string;
  uptimeMs?: number;
  errors: string[];
  features: {
    sandbox: "active" | "unavailable" | "not_configured";
    pathPolicy: "active" | "not_configured";
    importWatch: "active" | "not_configured";
  };
}

// ─── Preview Result ───────────────────

export interface SchedulePreview {
  scheduleType: string;
  normalized: string;
  nextOccurrences: string[];
  timezone?: string;
}

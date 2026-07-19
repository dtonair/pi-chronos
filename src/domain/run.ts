import type { UTCTimestamp } from "./job.js";

// ─── Run Status and Outcomes ──────────────────────

export type RunStatus =
  | "queued"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "abandoned"
  | "skipped";

export type TerminalRunStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "abandoned"
  | "skipped";

export type SkipReason =
  | "OVERLAP_SKIPPED"
  | "PAUSED_SKIPPED"
  | "DISABLED_SKIPPED"
  | "MISSED_SKIPPED";

// ─── Run Identity and State ─────────────────

export interface RunIdentity {
  readonly id: string;
  readonly jobId: string;
}

export interface RunEvent {
  timestamp: UTCTimestamp;
  status: RunStatus;
  message?: string;
}

export interface RunTiming {
  queuedAt: UTCTimestamp;
  claimedAt?: UTCTimestamp;
  startedAt?: UTCTimestamp;
  finishedAt?: UTCTimestamp;
}

export interface RunOutput {
  /** Truncated/preview text for inline display. */
  summary: string;
  /** Whether output was truncated to summary. */
  truncated: boolean;
  /** Size in bytes before truncation. */
  totalBytes: number;
  /** Path to full artifact file if retained. */
  artifactPath?: string;
  /** Aggregated stop reason from the child. */
  stopReason?: string;
  /** Usage stats from the child if available. */
  usage?: ChildUsage;
}

export interface ChildUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ─── The Run Aggregate ─────────────────────

export interface Run extends RunIdentity {
  status: RunStatus;
  /** The occurrence key this run is/was scheduled for. */
  occurrenceKey: string;
  /** UTC time this occurrence was scheduled for. */
  occurrenceAt: UTCTimestamp;
  /** The job revision at dispatch time. */
  jobRevision: number;
  /** Scheduler instance id that claimed/owns this run. */
  ownerId?: string;
  /** Lease deadline (ms epoch) when claim expires. */
  leaseDeadline?: UTCTimestamp;
  /** Output accumulated from the child process. */
  output?: RunOutput;
  /** Skip reason when status is skipped. */
  skipReason?: SkipReason;
  /** For catch-up runs: the first missed occurrence. */
  catchUpFirst?: UTCTimestamp;
  /** For catch-up runs: the last missed occurrence. */
  catchUpLast?: UTCTimestamp;
  /** For catch-up runs: number of occurrences aggregated. */
  catchUpCount?: number;
  timing: RunTiming;
  /** Ordered status transition log. */
  events: RunEvent[];
}

// ─── Terminal immutability ─────────────────

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "abandoned",
  "skipped",
]);

export function isTerminalRunStatus(s: RunStatus): s is TerminalRunStatus {
  return TERMINAL_RUN_STATUSES.has(s);
}

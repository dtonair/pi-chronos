/** A point in time represented as UTC epoch milliseconds inside the core. */
export type UTCTimestamp = number & { readonly __brand: "UTCTimestamp" };

/** A validated IANA time-zone identifier. */
export type Timezone = string & { readonly __brand: "Timezone" };

export interface OnceSchedule {
  kind: "once";
  /** Requested ISO-8601 instant or local date-time. */
  runAt: string;
  /** Required when runAt does not contain an offset. */
  timezone?: string;
}

export interface IntervalSchedule {
  kind: "interval";
  everyMs: number;
  /** UTC ISO-8601 anchor. The creation service supplies one when omitted. */
  anchorAt?: string;
}

export interface CronSchedule {
  kind: "cron";
  expression: string;
  timezone: string;
}

export type JobSchedule = OnceSchedule | IntervalSchedule | CronSchedule;

export type JobStatus =
  | "draft"
  | "pending_approval"
  | "active"
  | "paused"
  | "disabled"
  | "archived"
  | "invalid";

export type JobSource = "tool" | "direct_user" | "project_import";
export type JobScope = "user" | "project" | "session";
export type OverlapPolicy = "skip";
export type MissedRunPolicy = "skip" | "run_once";

export interface ScopeIdentity {
  scope: JobScope;
  /** user, canonical project path, or session id plus canonical project path. */
  scopeKey: string;
}

export interface JobEnvironment {
  /** Approved non-secret values. */
  values: Record<string, string>;
  /** Names resolved only when a child is launched; values are never persisted. */
  secretNames: string[];
}

export interface JobExecution {
  mode: "subagent";
  workingDirectory: string;
  timeoutMs: number;
  maxOutputBytes: number;
  overlapPolicy: OverlapPolicy;
  missedRunPolicy: MissedRunPolicy;
  sandboxRequired: boolean;
  environment: JobEnvironment;
}

export interface JobIdentity {
  readonly id: string;
  readonly revision: number;
}

export interface JobDefinition {
  name: string;
  description?: string;
  tags: string[];
  prompt: string;
  schedule: JobSchedule;
  /** Resolved provider/model identifier. This is always explicit before persistence. */
  model: string;
  identity: ScopeIdentity;
  execution: JobExecution;
  permissions: import("./permission.js").JobPermissions;
  source: JobSource;
  importKey?: string;
}

export interface Job extends JobIdentity {
  schemaVersion: 1;
  definition: JobDefinition;
  status: JobStatus;
  fingerprint: string;
  approvedFingerprint?: string;
  createdAt: UTCTimestamp;
  createdBy: string;
  updatedAt: UTCTimestamp;
  updatedBy: string;
  approvedAt?: UTCTimestamp;
  nextRunAt: UTCTimestamp | null;
  lastScheduledAt?: UTCTimestamp;
  lastRunAt?: UTCTimestamp;
  lastSuccessAt?: UTCTimestamp;
  consecutiveFailures: number;
  diagnosticCode?: string;
  diagnosticMessage?: string;
}

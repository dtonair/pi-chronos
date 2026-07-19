// ─── Schedule Types ────────────────────────

/** A point in time, UTC epoch milliseconds. */
export type UTCTimestamp = number & { readonly __brand: "UTCTimestamp" };

/** An IANA timezone string (e.g. "America/New_York"). */
export type Timezone = string & { readonly __brand: "Timezone" };

/** A once schedule fires at exactly one wall-clock instant. */
export interface OnceSchedule {
  type: "once";
  /** ISO-8601 instant or wall-clock time with IANA offset. Normalized at creation. */
  at: string;
  /** If true a past at is clamped to now; otherwise rejected. */
  allowPast: boolean;
}

/** Fixed-rate interval starting from a persistent anchor. */
export interface IntervalSchedule {
  type: "interval";
  /** ISO-8601 or UTC epoch ms string for the anchor occurrence. */
  anchor: string;
  /** Interval in milliseconds. Must be >= 1_000. */
  everyMs: number;
  /** IANA timezone for computing missed windows. */
  timezone: Timezone;
}

/** Five-field CRON schedule (minute hour dom month dow). Six-field input rejected. */
export interface CronSchedule {
  type: "cron";
  /** Five-field cron expression. */
  expression: string;
  /** IANA timezone. */
  timezone: Timezone;
}

export type Schedule = OnceSchedule | IntervalSchedule | CronSchedule;

// ─── Job Types ─────────────────────

/** How many concurrent runs of this job may execute at once. */
export type ConcurrencyPolicy =
  | { readonly type: "single" }
  | { readonly type: "max"; readonly limit: number };

export type JobStatus =
  | "pending_approval"
  | "active"
  | "paused"
  | "disabled"
  | "completed"
  | "archived";

export type JobSource = "tool" | "direct_user" | "project_import";

export interface JobIdentity {
  readonly id: string;
  readonly revision: number;
}

export interface JobDefinition {
  /** User-provided display name. Unique within scope. */
  name: string;
  /** Opaque grouping key for scoped uniqueness. */
  scope: string;
  description?: string;
  schedule: Schedule;
  /** Prompt text sent to the child agent as stdin. */
  prompt: string;
  /** Model specifier (provider/model). Imported jobs must include it. */
  model?: string;
  /** Explicit tool allowlist. Empty/undefined = built-in tool set. */
  tools?: readonly string[];
  /** Extension allowlist. Must be empty in current version. */
  extensions?: readonly string[];
  /** Read-only filesystem paths permitted. */
  readPaths?: readonly string[];
  /** Write-only filesystem paths permitted. */
  writePaths?: readonly string[];
  /** Allowed shell command patterns (exact pre-mutation matching). */
  shellCommands?: readonly string[];
  /** Allowed environment variable names. */
  envNames?: readonly string[];
  /** Whether OS sandbox is required. */
  sandboxRequired: boolean;
  concurrency: ConcurrencyPolicy;
  /** Maximum wall-clock duration per run in ms. 0 = no limit. */
  timeoutMs: number;
  /** Grace period after cancellation signal before force kill in ms. */
  graceMs: number;
  /** Maximum retained output bytes per run. */
  maxOutputBytes: number;
  /** Retain full output as a separate artifact file. */
  retainArtifact: boolean;
  /** Job source for authorization rules. */
  source: JobSource;
  /** Import file path + project identity for imported jobs. */
  importKey?: string;
  /** Config version from the import file for reconciliation. */
  importVersion?: number;
}

export interface Job extends JobIdentity {
  definition: JobDefinition;
  status: JobStatus;
  /** SHA-256 fingerprint of security-relevant fields. */
  fingerprint: string;
  /** If approved, the fingerprint at approval time. */
  approvedFingerprint?: string;
  /** UTC timestamp when the job was created. */
  createdAt: UTCTimestamp;
  /** UTC timestamp of last mutation. */
  updatedAt: UTCTimestamp;
  /** UTC timestamp when the job was last approved, if any. */
  approvedAt?: UTCTimestamp;
  /** Next scheduled UTC run. null means no pending occurrences. */
  nextRunAt: UTCTimestamp | null;
  /** Total successful runs (terminal with exit 0). */
  successCount: number;
  /** Total failed runs (terminal non-zero, timeout, or error). */
  failureCount: number;
}

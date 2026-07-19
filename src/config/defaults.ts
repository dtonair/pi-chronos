import type { ConcurrencyPolicy, JobSource } from "../domain/job.js";

// ─── Configuration Defaults ─────────────────

export interface ChronosConfig {
  /** SQLite database file path. */
  dbPath: string;
  /** Data directory for artifacts. */
  dataDir: string;
  /** Import watch directory (relative to project). */
  importDir: string;
  /** Scheduler poll interval when cross-process timer. */
  pollIntervalMs: number;
  /** Heartbeat interval for instance liveness. */
  heartbeatIntervalMs: number;
  /** Stale instance timeout (no heartbeat). */
  instanceStaleTimeoutMs: number;
  /** Lease duration for run claims. */
  leaseDurationMs: number;
  /** Lease renewal interval (fraction of lease). */
  leaseRenewalIntervalMs: number;
  /** Max concurrent child processes. */
  maxConcurrentChildren: number;
  /** Max queued runs before backpressure. */
  maxQueuedRuns: number;
  /** Default values for new jobs. */
  defaults: JobDefaults;
  /** Limits for imports. */
  importLimits: ImportLimits;
}

export interface JobDefaults {
  scope: string;
  sandboxRequired: boolean;
  timeoutMs: number;
  graceMs: number;
  maxOutputBytes: number;
  retainArtifact: boolean;
  concurrency: ConcurrencyPolicy;
}

export interface ImportLimits {
  maxFileBytes: number;
  maxJobs: number;
}

// ─── Default Configuration ───────────────

export const DEFAULT_CONFIG: ChronosConfig = {
  dbPath: "", // Resolved at runtime through Pi's agent directory
  dataDir: "",
  importDir: "chronos/jobs",
  pollIntervalMs: 5_000,
  heartbeatIntervalMs: 15_000,
  instanceStaleTimeoutMs: 45_000,
  leaseDurationMs: 30_000,
  leaseRenewalIntervalMs: 10_000,
  maxConcurrentChildren: 4,
  maxQueuedRuns: 100,
  defaults: {
    scope: "default",
    sandboxRequired: false,
    timeoutMs: 0, // No timeout by default
    graceMs: 10_000,
    maxOutputBytes: 51_200, // 50 KB
    retainArtifact: false,
    concurrency: { type: "single" },
  },
  importLimits: {
    maxFileBytes: 1_048_576, // 1 MiB
    maxJobs: 1_000,
  },
};

/** All valid job sources. */
export const JOB_SOURCES: ReadonlySet<JobSource> = new Set([
  "tool",
  "direct_user",
  "project_import",
]);

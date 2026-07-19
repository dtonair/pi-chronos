import type { UTCTimestamp } from "../domain/job.js";

// ─── Clock Interface ──────────────────────

export interface Clock {
  /** Current UTC epoch milliseconds. */
  now(): UTCTimestamp;
  /** Set a timeout that fires once. Returns handle. */
  setTimeout(fn: () => void, ms: number): ClockTimer;
  /** Chronos timer clamp, below Node's signed 32-bit timeout ceiling. */
  readonly maxTimeoutMs: number;
}

export interface ClockTimer {
  /** Clear the timeout without firing. */
  clear(): void;

  /** Refresh the timer. */
  refresh(ms: number): void;
}

// ─── ID Generator Interface ──────────────

export interface IdGenerator {
  /** Generate a unique id string. */
  generate(): string;
  /** Length of generated identifiers in characters. */
  readonly length: number;
}

// ─── Logger Interface ─────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: UTCTimestamp;
  instanceId?: string;
  /** Arbitrary structured data. */
  data?: Record<string, unknown>;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  /** The minimum level emitted. */
  readonly level: LogLevel;
}

// ─── Event Sink ─────────────────

export interface EventSink {
  /** Publish a domain event to all subscribers. */
  emit(event: import("../domain/events.js").DomainEvent): void;
  /** Subscribe to domain events. */
  on(
    type: import("../domain/events.js").DomainEventType,
    handler: (event: import("../domain/events.js").DomainEvent) => void,
  ): () => void;
}

// ─── Path Canonicalizer ──────────────────

export interface PathCanonicalizer {
  /** Resolve and canonicalize a path for policy comparison. */
  canonicalize(relPath: string, cwd: string): string;
  /** Check if a path exists (filesystem call). */
  exists(path: string): Promise<boolean>;
  /** Return the realpath (resolves symlinks). */
  realpath(path: string): Promise<string>;
}

// ─── Process Launcher ────────────────────

export interface ProcessLauncher {
  /** Launch a detached child process in its own group. */
  spawn(executable: string, args: readonly string[], options: ProcessSpawnOptions): ProcessHandle;
}

export interface ProcessSpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
}

export interface ProcessHandle {
  readonly pid: number;
  /** Resolves with the final result when the process exits. */
  readonly completed: Promise<ProcessResult>;
  /** Send SIGTERM (graceful). */
  terminate(): void;
  /** Send SIGKILL (force). */
  kill(): void;
}

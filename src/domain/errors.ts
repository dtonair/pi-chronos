// ─── Chronos Error Codes ──────────────────

export const ChronosErrorCode = {
  // Validation
  INVALID_SCHEDULE: "INVALID_SCHEDULE",
  INVALID_JOB_DEFINITION: "INVALID_JOB_DEFINITION",
  INVALID_TIMEZONE: "INVALID_TIMEZONE",
  INVALID_CRON: "INVALID_CRON",
  INVALID_INTERVAL: "INVALID_INTERVAL",
  PAST_ONCE_SCHEDULE: "PAST_ONCE_SCHEDULE",
  NO_FUTURE_OCCURRENCE: "NO_FUTURE_OCCURRENCE",
  MALFORMED_JSON: "MALFORMED_JSON",
  OVERSIZED_INPUT: "OVERSIZED_INPUT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  VALUE_TOO_LONG: "VALUE_TOO_LONG",
  VALUE_OUT_OF_RANGE: "VALUE_OUT_OF_RANGE",

  // Job lifecycle
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  JOB_NAME_CONFLICT: "JOB_NAME_CONFLICT",
  JOB_REVISION_CONFLICT: "JOB_REVISION_CONFLICT",
  JOB_NOT_APPROVED: "JOB_NOT_APPROVED",
  JOB_NOT_ACTIVE: "JOB_NOT_ACTIVE",
  JOB_ALREADY_ACTIVE: "JOB_ALREADY_ACTIVE",
  JOB_TERMINAL: "JOB_TERMINAL",
  JOB_ARCHIVED: "JOB_ARCHIVED",
  JOB_DISABLED: "JOB_DISABLED",

  // Approval
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  INTERACTIVE_APPROVAL_REQUIRED: "INTERACTIVE_APPROVAL_REQUIRED",
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  FINGERPRINT_MISMATCH: "FINGERPRINT_MISMATCH",
  ALREADY_APPROVED: "ALREADY_APPROVED",
  NOT_APPROVED: "NOT_APPROVED",

  // Run lifecycle
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  RUN_NOT_TERMINAL: "RUN_NOT_TERMINAL",
  RUN_ALREADY_TERMINAL: "RUN_ALREADY_TERMINAL",
  RUN_NOT_OWNED: "RUN_NOT_OWNED",
  RUN_LEASE_EXPIRED: "RUN_LEASE_EXPIRED",
  EXECUTOR_LEASE_EXPIRED: "EXECUTOR_LEASE_EXPIRED",
  RUN_CONCURRENCY_LIMIT: "RUN_CONCURRENCY_LIMIT",
  OVERLAP_SKIPPED: "OVERLAP_SKIPPED",
  DUPLICATE_OCCURRENCE: "DUPLICATE_OCCURRENCE",

  // Import
  IMPORT_NOT_TRUSTED: "IMPORT_NOT_TRUSTED",
  IMPORT_PARSE_ERROR: "IMPORT_PARSE_ERROR",
  IMPORT_LIMIT_EXCEEDED: "IMPORT_LIMIT_EXCEEDED",
  IMPORT_SOURCE_MISSING: "IMPORT_SOURCE_MISSING",
  IMPORT_SECRETS_DETECTED: "IMPORT_SECRETS_DETECTED",

  // Permission
  TOOL_NOT_ALLOWED: "TOOL_NOT_ALLOWED",
  PATH_NOT_ALLOWED: "PATH_NOT_ALLOWED",
  SHELL_NOT_ALLOWED: "SHELL_NOT_ALLOWED",
  ENV_NOT_ALLOWED: "ENV_NOT_ALLOWED",
  SANDBOX_UNAVAILABLE: "SANDBOX_UNAVAILABLE",
  SANDBOX_REQUIRED: "SANDBOX_REQUIRED",
  MANIFEST_EXPIRED: "MANIFEST_EXPIRED",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  MANIFEST_REPLAY: "MANIFEST_REPLAY",

  // Execution
  EXECUTOR_NOT_FOUND: "EXECUTOR_NOT_FOUND",
  CHILD_EXIT_ERROR: "CHILD_EXIT_ERROR",
  CHILD_TIMEOUT: "CHILD_TIMEOUT",
  CHILD_CANCELLED: "CHILD_CANCELLED",
  CHILD_ABANDONED: "CHILD_ABANDONED",
  OUTPUT_LIMIT_EXCEEDED: "OUTPUT_LIMIT_EXCEEDED",
  SECRET_REDACTION_FAILED: "SECRET_REDACTION_FAILED",

  // Storage
  DB_LOCKED: "DB_LOCKED",
  DB_MIGRATION_FAILED: "DB_MIGRATION_FAILED",
  DB_CORRUPT_ROW: "DB_CORRUPT_ROW",
  DB_UNSUPPORTED: "DB_UNSUPPORTED",

  // Instance
  INSTANCE_NOT_REGISTERED: "INSTANCE_NOT_REGISTERED",
  INSTANCE_STALE: "INSTANCE_STALE",
  INSTANCE_HEARTBEAT_LOST: "INSTANCE_HEARTBEAT_LOST",

  // Scheduler
  SCHEDULER_STOPPED: "SCHEDULER_STOPPED",
  SCHEDULER_ERROR: "SCHEDULER_ERROR",
  TIMER_ARM_FAILED: "TIMER_ARM_FAILED",

  // General
  INTERNAL_ERROR: "INTERNAL_ERROR",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  INVALID_PAGINATION: "INVALID_PAGINATION",
} as const;

export type ChronosErrorCode = (typeof ChronosErrorCode)[keyof typeof ChronosErrorCode];

// ─── Structured Chronos Error ────────────────────

export interface ChronosErrorDetails {
  code: ChronosErrorCode;
  message: string;
  /** Entity id or path that caused the error. */
  entity?: string;
  /** Additional structured metadata. */
  meta?: Record<string, unknown>;
  /** Underlying cause for internal/wrapped errors. */
  cause?: unknown;
}

export class ChronosError extends Error {
  public readonly code: ChronosErrorCode;
  public readonly entity?: string;
  public readonly meta: Record<string, unknown>;

  constructor(details: ChronosErrorDetails) {
    super(details.message);
    this.name = "ChronosError";
    this.code = details.code;
    this.entity = details.entity;
    this.meta = details.meta ?? {};
    if (details.cause !== undefined) {
      this.cause = details.cause;
    }
  }

  /** Create a ChronosError from another error, preserving the cause. */
  static wrap(
    code: ChronosErrorCode,
    message: string,
    cause: unknown,
    entity?: string,
  ): ChronosError {
    return new ChronosError({ code, message, cause, entity });
  }

  /** Serialize for API responses. */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      entity: this.entity,
      meta: this.meta,
    };
  }
}

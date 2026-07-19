/** Stable error codes exposed by the scheduler tool and commands. */
export const ChronosErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  JOB_NAME_CONFLICT: "JOB_NAME_CONFLICT",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  INVALID_SCHEDULE: "INVALID_SCHEDULE",
  TIMEZONE_INVALID: "TIMEZONE_INVALID",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVAL_INVALIDATED: "APPROVAL_INVALIDATED",
  INTERACTIVE_APPROVAL_REQUIRED: "INTERACTIVE_APPROVAL_REQUIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNSUPPORTED_TOOL: "UNSUPPORTED_TOOL",
  UNSUPPORTED_OPERATION: "UNSUPPORTED_OPERATION",
  RUN_NOT_FOUND: "RUN_NOT_FOUND",
  RUN_ALREADY_TERMINAL: "RUN_ALREADY_TERMINAL",
  OVERLAP_SKIPPED: "OVERLAP_SKIPPED",
  EXECUTOR_UNAVAILABLE: "EXECUTOR_UNAVAILABLE",
  EXECUTOR_ERROR: "EXECUTOR_ERROR",
  EXECUTION_TIMEOUT: "EXECUTION_TIMEOUT",
  EXECUTION_CANCELLED: "EXECUTION_CANCELLED",
  EXECUTOR_LEASE_EXPIRED: "EXECUTOR_LEASE_EXPIRED",
  DATABASE_ERROR: "DATABASE_ERROR",
  SQLITE_UNAVAILABLE: "SQLITE_UNAVAILABLE",
  MIGRATION_ERROR: "MIGRATION_ERROR",
  IMPORT_ERROR: "IMPORT_ERROR",
  IMPORT_SOURCE_MISSING: "IMPORT_SOURCE_MISSING",
  SANDBOX_UNAVAILABLE: "SANDBOX_UNAVAILABLE",

  // More specific internal diagnostics. These may be mapped to a stable public code.
  MALFORMED_JSON: "MALFORMED_JSON",
  OVERSIZED_INPUT: "OVERSIZED_INPUT",
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  VALUE_TOO_LONG: "VALUE_TOO_LONG",
  VALUE_OUT_OF_RANGE: "VALUE_OUT_OF_RANGE",
  PAST_ONCE_SCHEDULE: "PAST_ONCE_SCHEDULE",
  NO_FUTURE_OCCURRENCE: "NO_FUTURE_OCCURRENCE",
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  FINGERPRINT_MISMATCH: "FINGERPRINT_MISMATCH",
  RUN_NOT_OWNED: "RUN_NOT_OWNED",
  RUN_LEASE_EXPIRED: "RUN_LEASE_EXPIRED",
  DUPLICATE_OCCURRENCE: "DUPLICATE_OCCURRENCE",
  DB_LOCKED: "DB_LOCKED",
  DB_CORRUPT_ROW: "DB_CORRUPT_ROW",
  MANIFEST_EXPIRED: "MANIFEST_EXPIRED",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  MANIFEST_REPLAY: "MANIFEST_REPLAY",
  SECRET_REDACTION_FAILED: "SECRET_REDACTION_FAILED",
  SCHEDULER_STOPPED: "SCHEDULER_STOPPED",
  SCHEDULER_ERROR: "SCHEDULER_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ChronosErrorCode = (typeof ChronosErrorCode)[keyof typeof ChronosErrorCode];

export interface ChronosErrorDetails {
  code: ChronosErrorCode;
  message: string;
  entity?: string;
  meta?: Record<string, unknown>;
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
    if (details.cause !== undefined) this.cause = details.cause;
  }

  static wrap(
    code: ChronosErrorCode,
    message: string,
    cause: unknown,
    entity?: string,
  ): ChronosError {
    return new ChronosError({ code, message, cause, entity });
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      entity: this.entity,
      meta: this.meta,
    };
  }
}

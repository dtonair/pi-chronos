// ─── Public API entry point ────────────────

// API types
export type * from "./api/result.js";
export { SchedulerAction } from "./api/result.js";
export {
  decodeImportFile,
  decodeSchedulerToolInput,
  type ImportFile,
  ImportFileSchema,
  type JobDefinitionInput,
  JobDefinitionInputSchema,
  JobPermissionsSchema,
  JobScheduleSchema,
  PaginationParamsSchema,
  SchedulerHealthSchema,
  SchedulerResultSchema,
  type SchedulerToolInput,
  SchedulerToolInputSchema,
} from "./api/schemas.js";
export { type ChronosConfig, DEFAULT_CONFIG } from "./config/defaults.js";
export {
  type ChronosConfigOverrides,
  ChronosConfigOverridesSchema,
  createConfig,
  decodeConfig,
} from "./config/schema.js";
export type * from "./domain/approval.js";
export type * from "./domain/audit.js";
export {
  ChronosError,
  ChronosErrorCode,
  type ChronosErrorDetails,
} from "./domain/errors.js";
export type * from "./domain/events.js";
export type * from "./domain/instance.js";
// Domain types
export type * from "./domain/job.js";
export type * from "./domain/permission.js";
export type * from "./domain/run.js";
// Extension
export { default as chronosExtension } from "./extension/index.js";
// Scheduler
export type * from "./scheduler/cron.js";
export { createCronCalculator } from "./scheduler/cron.js";
export { nextIntervalOccurrence, resolveIntervalAnchor } from "./scheduler/interval.js";
export type { MissedRange } from "./scheduler/missed-run.js";
export { calculateMissedRange } from "./scheduler/missed-run.js";
export type { NextRunResult } from "./scheduler/next-run.js";
export { calculateNextRun } from "./scheduler/next-run.js";
export { occurrenceKeyFor } from "./scheduler/occurrence-key.js";
export type { NormalizedOnce } from "./scheduler/once.js";
export { normalizeOnce } from "./scheduler/once.js";
export { previewSchedule } from "./scheduler/preview.js";
export { calculateTimerDelay, isDelayClamped } from "./scheduler/timer-delay.js";
export type * from "./shared/ports.js";
// Shared
export type * from "./shared/result.js";
export { err, ok } from "./shared/result.js";

import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobSchedule } from "../domain/job.js";
import type { GuardSupportedTool } from "../domain/permission.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { SchedulerAction, type SchedulerAction as SchedulerActionName } from "./result.js";

export { Type };

const NullableString = Type.Union([Type.String(), Type.Null()]);
const SUPPORTED_TOOLS: ReadonlySet<string> = new Set<GuardSupportedTool>([
  "read",
  "grep",
  "find",
  "ls",
  "edit",
  "write",
  "bash",
  "chronos_exec",
  "chronos_atomic_write",
  "chronos_complete",
]);

export const OnceScheduleSchema = Type.Object(
  {
    kind: Type.Literal("once"),
    runAt: Type.String({ minLength: 1, maxLength: 64 }),
    timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

export const IntervalScheduleSchema = Type.Object(
  {
    kind: Type.Literal("interval"),
    everyMs: Type.Integer({ minimum: 1 }),
    anchorAt: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export const CronScheduleSchema = Type.Object(
  {
    kind: Type.Literal("cron"),
    expression: Type.String({ minLength: 1, maxLength: 256 }),
    timezone: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);

export const JobScheduleSchema = Type.Union([
  OnceScheduleSchema,
  IntervalScheduleSchema,
  CronScheduleSchema,
]);

export const JobStatusSchema = StringEnum([
  "draft",
  "pending_approval",
  "active",
  "paused",
  "disabled",
  "archived",
  "invalid",
] as const);
export const JobScopeSchema = StringEnum(["user", "project", "session"] as const);
export const JobSourceSchema = StringEnum(["tool", "direct_user", "project_import"] as const);
export const RunStatusSchema = StringEnum([
  "queued",
  "claimed",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "skipped",
  "abandoned",
] as const);

export const ProcessArgumentRuleSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("literal"), value: Type.String({ minLength: 1, maxLength: 4_096 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("slot"),
      name: Type.String({ minLength: 1, maxLength: 64 }),
      valueType: StringEnum(["uuid", "integer", "slug"] as const),
    },
    { additionalProperties: false },
  ),
]);

export const ProcessCommandRuleSchema = Type.Object(
  {
    executable: Type.String({ minLength: 1, maxLength: 4_096 }),
    args: Type.Array(ProcessArgumentRuleSchema, { maxItems: 32 }),
  },
  { additionalProperties: false },
);

export const ProcessPermissionsSchema = Type.Object(
  {
    allowed: Type.Boolean(),
    commands: Type.Array(ProcessCommandRuleSchema, { maxItems: 50 }),
  },
  { additionalProperties: false },
);

export const CompletionPolicySchema = Type.Union([
  Type.Object({ mode: Type.Literal("process_exit") }, { additionalProperties: false }),
  Type.Object(
    {
      mode: Type.Literal("explicit"),
      requiredOutputs: Type.Array(
        Type.Object(
          {
            path: Type.String({ minLength: 1, maxLength: 4_096 }),
            mutation: StringEnum(["atomic_replace", "exists"] as const),
          },
          { additionalProperties: false },
        ),
        { maxItems: 20 },
      ),
    },
    { additionalProperties: false },
  ),
]);

export const JobPermissionsSchema = Type.Object(
  {
    tools: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 11 }),
    shell: Type.Object(
      {
        allowed: Type.Boolean(),
        commands: Type.Array(Type.String({ minLength: 1, maxLength: 8_192 }), { maxItems: 100 }),
      },
      { additionalProperties: false },
    ),
    filesystem: Type.Object(
      {
        readPaths: Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), { maxItems: 200 }),
        writePaths: Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), {
          maxItems: 200,
        }),
      },
      { additionalProperties: false },
    ),
    network: Type.Object(
      {
        allowed: Type.Boolean(),
        domains: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 200 }),
      },
      { additionalProperties: false },
    ),
    extensions: Type.Object(
      {
        allowedIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 50 }),
      },
      { additionalProperties: false },
    ),
    secrets: Type.Object(
      {
        allowedNames: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
          maxItems: 100,
        }),
      },
      { additionalProperties: false },
    ),
    process: Type.Optional(ProcessPermissionsSchema),
  },
  { additionalProperties: false },
);

export const JobEnvironmentSchema = Type.Object(
  {
    values: Type.Record(
      Type.String({ minLength: 1, maxLength: 256 }),
      Type.String({ maxLength: 8_192 }),
    ),
    secretNames: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 100 }),
  },
  { additionalProperties: false },
);

export const JobExecutionInputSchema = Type.Object(
  {
    mode: Type.Optional(Type.Literal("subagent", { default: "subagent" })),
    workingDirectory: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 86_400_000 })),
    maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 10_485_760 })),
    overlapPolicy: Type.Optional(StringEnum(["skip"] as const, { default: "skip" })),
    missedRunPolicy: Type.Optional(StringEnum(["skip", "run_once"] as const, { default: "skip" })),
    sandboxRequired: Type.Optional(Type.Boolean({ default: false })),
    completion: Type.Optional(CompletionPolicySchema),
    environment: Type.Optional(JobEnvironmentSchema),
  },
  { additionalProperties: false },
);

export const JobPatchSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    description: Type.Optional(NullableString),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 50 }),
    ),
    prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 128_000 })),
    schedule: Type.Optional(JobScheduleSchema),
    model: Type.Optional(Type.String({ minLength: 3, maxLength: 256 })),
    execution: Type.Optional(JobExecutionInputSchema),
    permissions: Type.Optional(JobPermissionsSchema),
  },
  { additionalProperties: false },
);

export const JobDefinitionInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 4_096 })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 50 }),
    ),
    prompt: Type.String({ minLength: 1, maxLength: 128_000 }),
    schedule: JobScheduleSchema,
    model: Type.Optional(Type.String({ minLength: 3, maxLength: 256 })),
    scope: Type.Optional(StringEnum(["user", "project", "session"] as const)),
    execution: Type.Optional(JobExecutionInputSchema),
    permissions: Type.Optional(JobPermissionsSchema),
    requestApproval: Type.Optional(Type.Boolean()),
    allowPast: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type JobDefinitionInput = Static<typeof JobDefinitionInputSchema>;

export const SchedulerActionEnum = StringEnum([
  "preview",
  "create",
  "get",
  "list",
  "update",
  "pause",
  "resume",
  "archive",
  "delete",
  "run_now",
  "cancel_run",
  "history",
  "approve",
  "revoke_approval",
  "import",
  "health",
] as const);

/** Provider-compatible tool schema. Action-specific consistency is enforced after decoding. */
export const SchedulerToolInputSchema = Type.Object(
  {
    action: SchedulerActionEnum,
    jobId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    runId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    description: Type.Optional(Type.String({ maxLength: 4_096 })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 50 }),
    ),
    prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 128_000 })),
    schedule: Type.Optional(JobScheduleSchema),
    model: Type.Optional(Type.String({ minLength: 3, maxLength: 256 })),
    scope: Type.Optional(StringEnum(["user", "project", "session"] as const)),
    execution: Type.Optional(JobExecutionInputSchema),
    permissions: Type.Optional(JobPermissionsSchema),
    requestApproval: Type.Optional(Type.Boolean()),
    allowPast: Type.Optional(Type.Boolean()),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    patch: Type.Optional(JobPatchSchema),
    overridePaused: Type.Optional(Type.Boolean()),
    cursor: Type.Optional(Type.String({ maxLength: 4_096 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    confirmationToken: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
    fingerprint: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export type SchedulerToolInput = Static<typeof SchedulerToolInputSchema>;

export const ImportJobSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 4_096 })),
    tags: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 50 }),
    ),
    prompt: Type.String({ minLength: 1, maxLength: 128_000 }),
    schedule: JobScheduleSchema,
    model: Type.String({ minLength: 3, maxLength: 256 }),
    execution: Type.Optional(JobExecutionInputSchema),
    permissions: Type.Optional(JobPermissionsSchema),
    allowPast: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ImportFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    jobs: Type.Array(ImportJobSchema, { maxItems: 1_000 }),
  },
  { additionalProperties: false },
);

export type ImportFile = Static<typeof ImportFileSchema>;

export const PaginationParamsSchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ maxLength: 4_096 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const SchedulerHealthSchema = Type.Object(
  {
    databaseState: StringEnum(["closed", "ready", "failed"] as const),
    migrationVersion: Type.Optional(Type.Integer({ minimum: 0 })),
    timerState: StringEnum(["stopped", "armed", "waking"] as const),
    instanceId: Type.Optional(Type.String()),
    heartbeatAt: Type.Optional(Type.String()),
    queueDepth: Type.Integer({ minimum: 0 }),
    activeChildren: Type.Integer({ minimum: 0 }),
    staleLeases: Type.Integer({ minimum: 0 }),
    activeJobs: Type.Integer({ minimum: 0 }),
    pendingApprovalJobs: Type.Integer({ minimum: 0 }),
    runningRuns: Type.Integer({ minimum: 0 }),
    metrics: Type.Optional(
      Type.Object(
        {
          wakes: Type.Integer({ minimum: 0 }),
          dispatches: Type.Integer({ minimum: 0 }),
          queuedRuns: Type.Integer({ minimum: 0 }),
          succeeded: Type.Integer({ minimum: 0 }),
          failed: Type.Integer({ minimum: 0 }),
          skipped: Type.Integer({ minimum: 0 }),
          abandoned: Type.Integer({ minimum: 0 }),
          policyDenials: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    lastSchedulerError: Type.Optional(
      Type.Object(
        {
          code: Type.String(),
          message: Type.String(),
          details: Type.Optional(Type.Unknown()),
        },
        { additionalProperties: false },
      ),
    ),
    enforcement: Type.Object(
      {
        toolAndPathPolicy: StringEnum(["active", "inactive"] as const),
        osSandbox: StringEnum(["active-tool-subprocess", "unavailable", "disabled"] as const),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const SchedulerResultSchema = Type.Object(
  {
    ok: Type.Boolean(),
    data: Type.Optional(Type.Unknown()),
    presentation: Type.Optional(Type.String()),
    warnings: Type.Optional(
      Type.Array(
        Type.Object(
          { code: Type.String(), message: Type.String() },
          { additionalProperties: false },
        ),
        { maxItems: 100 },
      ),
    ),
    error: Type.Optional(
      Type.Object(
        {
          code: Type.String(),
          message: Type.String(),
          details: Type.Optional(Type.Unknown()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const PersistedJobPermissionsValueSchema = Type.Object(
  {
    tools: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 11 }),
    shell: Type.Object(
      {
        allowed: Type.Boolean(),
        commands: Type.Array(Type.String({ minLength: 1, maxLength: 8_192 }), { maxItems: 100 }),
      },
      { additionalProperties: false },
    ),
    filesystem: Type.Object(
      {
        readPaths: Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), { maxItems: 200 }),
        writePaths: Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), {
          maxItems: 200,
        }),
      },
      { additionalProperties: false },
    ),
    network: Type.Object(
      {
        allowed: Type.Boolean(),
        domains: Type.Array(Type.String({ minLength: 1, maxLength: 253 }), { maxItems: 200 }),
      },
      { additionalProperties: false },
    ),
    extensions: Type.Object(
      {
        allowedIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 50 }),
      },
      { additionalProperties: false },
    ),
    secrets: Type.Object(
      {
        allowedNames: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
          maxItems: 100,
        }),
      },
      { additionalProperties: false },
    ),
    process: ProcessPermissionsSchema,
  },
  { additionalProperties: false },
);

/** Persisted JSON documents carry independent versions before being embedded in SQL text. */
export const PersistedScheduleSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    value: JobScheduleSchema,
    requestedRunAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export const PersistedExecutionSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    model: Type.String({ minLength: 3, maxLength: 256 }),
    mode: Type.Literal("subagent"),
    workingDirectory: Type.String(),
    timeoutMs: Type.Integer(),
    maxOutputBytes: Type.Integer(),
    overlapPolicy: Type.Literal("skip"),
    missedRunPolicy: StringEnum(["skip", "run_once"] as const),
    sandboxRequired: Type.Boolean(),
    completion: CompletionPolicySchema,
    environment: JobEnvironmentSchema,
  },
  { additionalProperties: false },
);
export const PersistedPermissionsSchema = Type.Object(
  { schemaVersion: Type.Literal(1), value: PersistedJobPermissionsValueSchema },
  { additionalProperties: false },
);
export const RunMetadataSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    firstMissedAt: Type.Optional(Type.String()),
    lastMissedAt: Type.Optional(Type.String()),
    missedCount: Type.Optional(Type.Integer({ minimum: 1 })),
    model: Type.Optional(Type.String()),
    stopReason: Type.Optional(Type.String()),
    outputTotalBytes: Type.Optional(Type.Integer({ minimum: 0 })),
    toolActivity: Type.Optional(Type.Array(Type.String(), { maxItems: 1_000 })),
    completionSummary: Type.Optional(Type.String({ maxLength: 4_096 })),
    completionCategory: Type.Optional(Type.String({ maxLength: 64 })),
    toolErrorCount: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000 })),
  },
  { additionalProperties: false },
);

export const JobRowSchema = Type.Object(
  {
    id: Type.String(),
    schema_version: Type.Literal(1),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    normalized_name: Type.String(),
    description: nullable(Type.String()),
    prompt: Type.String(),
    tags_json: Type.String(),
    status: JobStatusSchema,
    scope: JobScopeSchema,
    scope_key: Type.String(),
    source: JobSourceSchema,
    import_key: nullable(Type.String()),
    schedule_json: Type.String(),
    execution_json: Type.String(),
    permissions_json: Type.String(),
    approval_required: Type.Union([Type.Literal(0), Type.Literal(1)]),
    approved_fingerprint: nullable(Type.String()),
    next_run_at: nullable(Type.String()),
    last_scheduled_at: nullable(Type.String()),
    last_run_at: nullable(Type.String()),
    last_success_at: nullable(Type.String()),
    consecutive_failures: Type.Integer(),
    diagnostic_code: nullable(Type.String()),
    diagnostic_message: nullable(Type.String()),
    created_at: Type.String(),
    created_by: Type.String(),
    updated_at: Type.String(),
    updated_by: Type.String(),
    revision: Type.Integer(),
  },
  { additionalProperties: false },
);

export const RunRowSchema = Type.Object(
  {
    id: Type.String(),
    job_id: Type.String(),
    occurrence_key: Type.String(),
    trigger: Type.String(),
    scheduled_at: Type.String(),
    queued_at: Type.String(),
    claimed_at: nullable(Type.String()),
    started_at: nullable(Type.String()),
    finished_at: nullable(Type.String()),
    status: RunStatusSchema,
    attempt: Type.Integer({ minimum: 1 }),
    executor_id: nullable(Type.String()),
    lease_expires_at: nullable(Type.String()),
    parent_run_id: nullable(Type.String()),
    output_summary: nullable(Type.String()),
    output_location: nullable(Type.String()),
    output_truncated: Type.Union([Type.Literal(0), Type.Literal(1)]),
    error_code: nullable(Type.String()),
    error_message: nullable(Type.String()),
    error_details: nullable(Type.String()),
    metadata_json: nullable(Type.String()),
    duration_ms: nullable(Type.Integer({ minimum: 0 })),
    created_at: Type.String(),
  },
  { additionalProperties: false },
);

export const ApprovalRowSchema = Type.Object(
  {
    id: Type.String(),
    job_id: Type.String(),
    fingerprint: Type.String(),
    approved_by: Type.String(),
    approved_at: Type.String(),
    revoked_at: nullable(Type.String()),
    source: Type.String(),
  },
  { additionalProperties: false },
);

export const SchedulerInstanceRowSchema = Type.Object(
  {
    id: Type.String(),
    hostname: nullable(Type.String()),
    process_id: nullable(Type.Integer()),
    started_at: Type.String(),
    heartbeat_at: Type.String(),
    stopped_at: nullable(Type.String()),
  },
  { additionalProperties: false },
);

export const AuditEventRowSchema = Type.Object(
  {
    id: Type.String(),
    event_name: Type.String(),
    actor: Type.String(),
    job_id: nullable(Type.String()),
    run_id: nullable(Type.String()),
    timestamp: Type.String(),
    old_fingerprint: nullable(Type.String()),
    new_fingerprint: nullable(Type.String()),
    details_json: Type.String(),
  },
  { additionalProperties: false },
);

function schemaError(schema: TSchema, value: unknown, context: string): ChronosError | undefined {
  const issues = [...Value.Errors(schema, value)];
  if (issues.length === 0) return undefined;
  return new ChronosError({
    code: ChronosErrorCode.VALIDATION_ERROR,
    message: `Invalid ${context}`,
    meta: {
      issues: issues.slice(0, 20).map((issue) => ({
        path: issue.instancePath,
        message: issue.message,
      })),
    },
  });
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function scheduleSemanticError(
  schedule: JobSchedule,
  minimumIntervalMs: number,
): ChronosError | undefined {
  if (schedule.kind === "interval") {
    if (schedule.everyMs < minimumIntervalMs) {
      return new ChronosError({
        code: ChronosErrorCode.INVALID_SCHEDULE,
        message: `Interval must be at least ${minimumIntervalMs}ms`,
      });
    }
    if (schedule.anchorAt !== undefined && Number.isNaN(Date.parse(schedule.anchorAt))) {
      return new ChronosError({
        code: ChronosErrorCode.INVALID_SCHEDULE,
        message: "Interval anchorAt must be ISO 8601",
      });
    }
    return undefined;
  }

  if (schedule.kind === "cron") {
    if (schedule.expression.trim().split(/\s+/).length !== 5) {
      return new ChronosError({
        code: ChronosErrorCode.INVALID_SCHEDULE,
        message: "Cron expressions must contain exactly five fields",
      });
    }
    if (!validTimezone(schedule.timezone)) {
      return new ChronosError({
        code: ChronosErrorCode.TIMEZONE_INVALID,
        message: `Invalid IANA timezone: ${schedule.timezone}`,
        entity: schedule.timezone,
      });
    }
    return undefined;
  }

  const hasOffset = /(?:z|[+-]\d{2}:\d{2})$/i.test(schedule.runAt);
  const isoDateTime =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:z|[+-]\d{2}:\d{2})?$/i;
  if (
    !isoDateTime.test(schedule.runAt) ||
    Number.isNaN(Date.parse(hasOffset ? schedule.runAt : `${schedule.runAt}Z`))
  ) {
    return new ChronosError({
      code: ChronosErrorCode.INVALID_SCHEDULE,
      message: "once.runAt must be an ISO-8601 date-time",
    });
  }
  if (!hasOffset && schedule.timezone === undefined) {
    return new ChronosError({
      code: ChronosErrorCode.INVALID_SCHEDULE,
      message: "An IANA timezone is required when once.runAt has no offset",
    });
  }
  if (schedule.timezone !== undefined && !validTimezone(schedule.timezone)) {
    return new ChronosError({
      code: ChronosErrorCode.TIMEZONE_INVALID,
      message: `Invalid IANA timezone: ${schedule.timezone}`,
      entity: schedule.timezone,
    });
  }
  return undefined;
}

function completionSemanticError(
  completion: Static<typeof CompletionPolicySchema> | undefined,
): ChronosError | undefined {
  if (completion === undefined || completion.mode === "process_exit") return undefined;
  const seen = new Set<string>();
  for (const output of completion.requiredOutputs) {
    if (
      output.path === "/" ||
      output.path === "\\" ||
      output.path === "." ||
      /^[A-Za-z]:[\\\\/]*$/.test(output.path) ||
      seen.has(output.path)
    ) {
      return new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: "Required output path is broad or duplicated",
      });
    }
    seen.add(output.path);
  }
  return undefined;
}

function permissionSemanticError(
  permissions: Static<typeof JobPermissionsSchema> | undefined,
): ChronosError | undefined {
  if (permissions === undefined) return undefined;
  const unsupportedTool = permissions.tools.find((tool) => !SUPPORTED_TOOLS.has(tool));
  if (unsupportedTool !== undefined) {
    return new ChronosError({
      code: ChronosErrorCode.UNSUPPORTED_TOOL,
      message: `Unsupported scheduled tool: ${unsupportedTool}`,
      entity: unsupportedTool,
    });
  }
  if (permissions.extensions.allowedIds.length > 0) {
    return new ChronosError({
      code: ChronosErrorCode.UNSUPPORTED_OPERATION,
      message: "Third-party extensions are not supported for scheduled jobs in version 1",
    });
  }
  if (!permissions.shell.allowed && permissions.shell.commands.length > 0) {
    return new ChronosError({
      code: ChronosErrorCode.VALIDATION_ERROR,
      message: "shell.commands must be empty when shell.allowed is false",
    });
  }
  if (!permissions.network.allowed && permissions.network.domains.length > 0) {
    return new ChronosError({
      code: ChronosErrorCode.VALIDATION_ERROR,
      message: "network.domains must be empty when network.allowed is false",
    });
  }
  if (permissions.process !== undefined) {
    if (!permissions.process.allowed && permissions.process.commands.length > 0) {
      return new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: "process.commands must be empty when process.allowed is false",
      });
    }
    for (const command of permissions.process.commands) {
      const slots = new Set<string>();
      if (command.executable.trim().length === 0) {
        return new ChronosError({
          code: ChronosErrorCode.VALIDATION_ERROR,
          message: "Process executable cannot be empty",
        });
      }
      for (const arg of command.args) {
        if (arg.kind === "slot") {
          if (slots.has(arg.name)) {
            return new ChronosError({
              code: ChronosErrorCode.VALIDATION_ERROR,
              message: "Process slot names must be unique",
            });
          }
          slots.add(arg.name);
        }
      }
    }
  }
  return undefined;
}

const ACTION_REQUIRED: Record<SchedulerActionName, readonly string[]> = {
  preview: ["schedule"],
  create: ["name", "prompt", "schedule"],
  get: ["jobId"],
  list: [],
  update: ["jobId", "expectedRevision", "patch"],
  pause: ["jobId"],
  resume: ["jobId"],
  archive: ["jobId"],
  delete: ["jobId"],
  run_now: ["jobId"],
  cancel_run: ["runId"],
  history: ["jobId"],
  approve: ["jobId"],
  revoke_approval: ["jobId"],
  import: [],
  health: [],
};

const CREATE_FIELDS = [
  "name",
  "description",
  "tags",
  "prompt",
  "schedule",
  "model",
  "scope",
  "execution",
  "permissions",
  "requestApproval",
  "allowPast",
] as const;

const ACTION_ALLOWED: Record<SchedulerActionName, ReadonlySet<string>> = {
  preview: new Set(["action", "schedule", "allowPast"]),
  create: new Set(["action", ...CREATE_FIELDS]),
  get: new Set(["action", "jobId"]),
  list: new Set(["action", "scope", "cursor", "limit"]),
  update: new Set(["action", "jobId", "expectedRevision", "patch"]),
  pause: new Set(["action", "jobId", "expectedRevision"]),
  resume: new Set(["action", "jobId", "expectedRevision"]),
  archive: new Set(["action", "jobId", "expectedRevision"]),
  delete: new Set(["action", "jobId", "expectedRevision"]),
  run_now: new Set(["action", "jobId", "overridePaused"]),
  cancel_run: new Set(["action", "runId"]),
  history: new Set(["action", "jobId", "cursor", "limit"]),
  approve: new Set(["action", "jobId", "fingerprint", "confirmationToken"]),
  revoke_approval: new Set(["action", "jobId", "fingerprint", "confirmationToken"]),
  import: new Set(["action"]),
  health: new Set(["action"]),
};

export function decodeSchedulerToolInput(
  value: unknown,
  minimumIntervalMs = 60_000,
): Result<SchedulerToolInput> {
  const structuralError = schemaError(SchedulerToolInputSchema, value, "scheduler input");
  if (structuralError !== undefined) return err(structuralError);
  const input = Value.Decode(SchedulerToolInputSchema, value);
  const present = new Set(Object.keys(value as Record<string, unknown>));

  const missing = ACTION_REQUIRED[input.action].filter((field) => !present.has(field));
  const forbidden = [...present].filter((field) => !ACTION_ALLOWED[input.action].has(field));
  if (missing.length > 0 || forbidden.length > 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: `Invalid fields for scheduler.${input.action}`,
        meta: { missing, forbidden },
      }),
    );
  }
  if (input.action === SchedulerAction.UPDATE && Object.keys(input.patch ?? {}).length === 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: "update.patch must contain at least one field",
      }),
    );
  }

  const schedule = input.action === SchedulerAction.UPDATE ? input.patch?.schedule : input.schedule;
  if (schedule !== undefined) {
    const semanticError = scheduleSemanticError(schedule, minimumIntervalMs);
    if (semanticError !== undefined) return err(semanticError);
  }
  const permissions =
    input.action === SchedulerAction.UPDATE ? input.patch?.permissions : input.permissions;
  const semanticPermissionError = permissionSemanticError(permissions);
  if (semanticPermissionError !== undefined) return err(semanticPermissionError);
  const execution =
    input.action === SchedulerAction.UPDATE ? input.patch?.execution : input.execution;
  const completionError = completionSemanticError(execution?.completion);
  if (completionError !== undefined) return err(completionError);
  return ok(input);
}

export function decodeImportFile(value: unknown, minimumIntervalMs = 60_000): Result<ImportFile> {
  const structuralError = schemaError(ImportFileSchema, value, "Chronos import file");
  if (structuralError !== undefined) return err(structuralError);
  const file = Value.Decode(ImportFileSchema, value);
  for (const job of file.jobs) {
    const scheduleError = scheduleSemanticError(job.schedule, minimumIntervalMs);
    if (scheduleError !== undefined) return err(scheduleError);
    const permissionError = permissionSemanticError(job.permissions);
    if (permissionError !== undefined) return err(permissionError);
    const completionError = completionSemanticError(job.execution?.completion);
    if (completionError !== undefined) return err(completionError);
    const environment = job.execution?.environment;
    if (
      environment !== undefined &&
      (Object.keys(environment.values).length > 0 || environment.secretNames.length > 0)
    ) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.IMPORT_ERROR,
          message: "Project imports cannot contain environment values or secret references",
        }),
      );
    }
  }
  return ok(file);
}

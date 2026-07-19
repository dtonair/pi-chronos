import { type Static, type TSchema, Type } from "typebox";

// Re-export Type for convenience
export { Type };

/**
 * StringEnum for enums. Uses Type.Unsafe to produce a compatible enum schema.
 * In production, Pi extensions use StringEnum from @earendil-works/pi-ai,
 * but for Phase 1 testing we create a compatible schema here.
 */
export function StringEnum<T extends readonly string[]>(values: T): TSchema {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: values as unknown as string[],
  });
}

// ─── Schedule Schemas ─────────────────

export const OnceScheduleSchema = Type.Object(
  {
    type: Type.Literal("once"),
    at: Type.String({ description: "ISO-8601 instant or wall-clock time" }),
    allowPast: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
);

export const IntervalScheduleSchema = Type.Object(
  {
    type: Type.Literal("interval"),
    anchor: Type.String({ description: "ISO-8601 anchor occurrence" }),
    everyMs: Type.Number({ minimum: 1_000, description: "Interval in milliseconds" }),
    timezone: Type.String({ description: "IANA timezone" }),
  },
  { additionalProperties: false },
);

export const CronScheduleSchema = Type.Object(
  {
    type: Type.Literal("cron"),
    expression: Type.String({ description: "Five-field cron expression" }),
    timezone: Type.String({ description: "IANA timezone" }),
  },
  { additionalProperties: false },
);

export const ScheduleSchema = Type.Union([
  OnceScheduleSchema,
  IntervalScheduleSchema,
  CronScheduleSchema,
]);

// ─── Concurrency Policy ───────────────

export const SingleConcurrencySchema = Type.Object(
  {
    type: Type.Literal("single"),
  },
  { additionalProperties: false },
);

export const MaxConcurrencySchema = Type.Object(
  {
    type: Type.Literal("max"),
    limit: Type.Number({ minimum: 1, maximum: 100 }),
  },
  { additionalProperties: false },
);

export const ConcurrencyPolicySchema = Type.Union([SingleConcurrencySchema, MaxConcurrencySchema]);

// ─── Job Definition Input Schema ──────

export const JobDefinitionInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 256 }),
    scope: Type.Optional(Type.String({ minLength: 1, maxLength: 256, default: "default" })),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    schedule: ScheduleSchema,
    prompt: Type.String({ minLength: 1, maxLength: 128_000 }),
    model: Type.Optional(Type.String({ maxLength: 256 })),
    tools: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
    extensions: Type.Optional(Type.Array(Type.String(), { maxItems: 0 })),
    readPaths: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
    writePaths: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
    shellCommands: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
    envNames: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
    sandboxRequired: Type.Optional(Type.Boolean({ default: false })),
    concurrency: Type.Optional(ConcurrencyPolicySchema),
    timeoutMs: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000, default: 0 })),
    graceMs: Type.Optional(Type.Number({ minimum: 0, maximum: 300_000, default: 10_000 })),
    maxOutputBytes: Type.Optional(
      Type.Number({ minimum: 1_024, maximum: 10_485_760, default: 51_200 }),
    ),
    retainArtifact: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
);

export type JobDefinitionInput = Static<typeof JobDefinitionInputSchema>;

// ─── Scheduler Tool Input ─────────────

export const SchedulerActionEnum = StringEnum([
  "list_jobs",
  "get_job",
  "create_job",
  "update_job",
  "pause_job",
  "resume_job",
  "archive_job",
  "delete_job",
  "run_now",
  "cancel_run",
  "get_run_history",
  "get_run",
  "approve_job",
  "revoke_approval",
  "preview_schedule",
  "import_jobs",
  "status",
] as const);

export const SchedulerToolInputSchema = Type.Object(
  {
    action: SchedulerActionEnum,
    // Common optional fields
    jobId: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    name: Type.Optional(Type.String({ maxLength: 256 })),
    scope: Type.Optional(Type.String({ maxLength: 256 })),
    definition: Type.Optional(JobDefinitionInputSchema),
    cursor: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    revision: Type.Optional(Type.Number({ minimum: 0 })),
    confirmationToken: Type.Optional(Type.String()),
    importPath: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type SchedulerToolInput = Static<typeof SchedulerToolInputSchema>;

// ─── Import Schema ────────────────────

export const ImportScheduleFieldSchema = Type.Object(
  {
    type: Type.String(),
    at: Type.Optional(Type.String()),
    allowPast: Type.Optional(Type.Boolean()),
    anchor: Type.Optional(Type.String()),
    everyMs: Type.Optional(Type.Number({ minimum: 1_000 })),
    timezone: Type.Optional(Type.String()),
    expression: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ImportJobSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 256 }),
    scope: Type.Optional(Type.String({ maxLength: 256 })),
    description: Type.Optional(Type.String({ maxLength: 4096 })),
    schedule: ImportScheduleFieldSchema,
    prompt: Type.String({ minLength: 1, maxLength: 128_000 }),
    model: Type.String({ maxLength: 256 }),
    tools: Type.Optional(Type.Array(Type.String(), { maxItems: 50 })),
    readPaths: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
    writePaths: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
    shellCommands: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
    envNames: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })),
    sandboxRequired: Type.Optional(Type.Boolean()),
    concurrency: Type.Optional(ConcurrencyPolicySchema),
    timeoutMs: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 })),
    graceMs: Type.Optional(Type.Number({ minimum: 0, maximum: 300_000 })),
    maxOutputBytes: Type.Optional(Type.Number({ minimum: 1_024, maximum: 10_485_760 })),
    retainArtifact: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const ImportFileSchema = Type.Object(
  {
    version: Type.Number({ minimum: 1, maximum: 1 }),
    project: Type.String({ minLength: 1, maxLength: 512 }),
    jobs: Type.Array(ImportJobSchema, { maxItems: 1_000 }),
  },
  { additionalProperties: false },
);

export type ImportFile = Static<typeof ImportFileSchema>;

// ─── SQLite Row Schemas (for reference, validated by codecs) ───

export const JobRowSchema = Type.Object(
  {
    id: Type.String(),
    revision: Type.Number(),
    name: Type.String(),
    scope: Type.String(),
    description: Type.Optional(Type.String()),
    schedule_json: Type.String(),
    prompt: Type.String(),
    model: Type.Optional(Type.String()),
    tools_json: Type.Optional(Type.String()),
    extensions_json: Type.Optional(Type.String()),
    read_paths_json: Type.Optional(Type.String()),
    write_paths_json: Type.Optional(Type.String()),
    shell_commands_json: Type.Optional(Type.String()),
    env_names_json: Type.Optional(Type.String()),
    sandbox_required: Type.Number(),
    concurrency_json: Type.String(),
    timeout_ms: Type.Number(),
    grace_ms: Type.Number(),
    max_output_bytes: Type.Number(),
    retain_artifact: Type.Number(),
    source: Type.String(),
    import_key: Type.Optional(Type.String()),
    import_version: Type.Optional(Type.Number()),
    status: Type.String(),
    fingerprint: Type.String(),
    approved_fingerprint: Type.Optional(Type.String()),
    created_at: Type.Number(),
    updated_at: Type.Number(),
    approved_at: Type.Optional(Type.Number()),
    next_run_at: Type.Optional(Type.Number()),
    success_count: Type.Number(),
    failure_count: Type.Number(),
  },
  { additionalProperties: false },
);

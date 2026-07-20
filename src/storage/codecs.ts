/**
 * Row codecs that validate embedded JSON before returning domain objects.
 *
 * Preserves malformed source data and returns record-level diagnostics
 * rather than crashing database startup (FR9).
 */

import type { JobApproval } from "../domain/approval.js";
import type { AuditEvent, AuditEventType } from "../domain/audit.js";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { SchedulerInstance } from "../domain/instance.js";
import type { Job, UTCTimestamp } from "../domain/job.js";
import type { JobPermissions } from "../domain/permission.js";
import type { Run, RunStatus } from "../domain/run.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

// ─── Row types ──────────────────

export interface JobRow {
  id: string;
  schema_version: number;
  name: string;
  normalized_name: string;
  description: string | null;
  prompt: string;
  tags_json: string;
  status: string;
  scope: string;
  scope_key: string;
  source: string;
  import_key: string | null;
  schedule_json: string;
  execution_json: string;
  permissions_json: string;
  approval_required: number;
  approved_fingerprint: string | null;
  next_run_at: string | null;
  last_scheduled_at: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  diagnostic_code: string | null;
  diagnostic_message: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  revision: number;
}

export interface RunRow {
  id: string;
  job_id: string;
  occurrence_key: string;
  trigger: string;
  scheduled_at: string;
  queued_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  attempt: number;
  executor_id: string | null;
  lease_expires_at: string | null;
  parent_run_id: string | null;
  output_summary: string | null;
  output_location: string | null;
  output_truncated: number;
  error_code: string | null;
  error_message: string | null;
  error_details: string | null;
  metadata_json: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface ApprovalRow {
  id: string;
  job_id: string;
  fingerprint: string;
  approved_by: string;
  approved_at: string;
  revoked_at: string | null;
  source: string;
}

export interface InstanceRow {
  id: string;
  hostname: string | null;
  process_id: number | null;
  started_at: string;
  heartbeat_at: string;
  stopped_at: string | null;
}

export interface AuditRow {
  id: string;
  event_name: string;
  actor: string;
  job_id: string | null;
  run_id: string | null;
  timestamp: string;
  old_fingerprint: string | null;
  new_fingerprint: string | null;
  details_json: string;
}

// ─── Helpers ──────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScheduleValue(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "once") return typeof value.runAt === "string";
  if (value.kind === "interval") {
    return (
      typeof value.everyMs === "number" && Number.isInteger(value.everyMs) && value.everyMs > 0
    );
  }
  return (
    value.kind === "cron" &&
    typeof value.expression === "string" &&
    typeof value.timezone === "string"
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key)) && keys.every((key) => key in value);
}

function isCompletionValue(
  value: unknown,
): value is import("../domain/permission.js").CompletionPolicy {
  if (!isRecord(value) || typeof value.mode !== "string") return false;
  if (value.mode === "process_exit") return exactKeys(value, ["mode"]);
  if (
    value.mode !== "explicit" ||
    !exactKeys(value, ["mode", "requiredOutputs"]) ||
    !Array.isArray(value.requiredOutputs)
  )
    return false;
  return value.requiredOutputs.every((output) => {
    return (
      isRecord(output) &&
      exactKeys(output, ["path", "mutation"]) &&
      typeof output.path === "string" &&
      (output.mutation === "exists" || output.mutation === "atomic_replace")
    );
  });
}

function isPermissionsValue(value: unknown): value is JobPermissions {
  if (!isRecord(value)) return false;
  const permissionKeys = ["tools", "shell", "filesystem", "network", "extensions", "secrets"];
  if (value.process !== undefined) permissionKeys.push("process");
  if (!exactKeys(value, permissionKeys)) return false;
  const shell = value.shell;
  const filesystem = value.filesystem;
  const network = value.network;
  const extensions = value.extensions;
  const secrets = value.secrets;
  return (
    Array.isArray(value.tools) &&
    isRecord(shell) &&
    exactKeys(shell, ["allowed", "commands"]) &&
    typeof shell.allowed === "boolean" &&
    Array.isArray(shell.commands) &&
    isRecord(filesystem) &&
    exactKeys(filesystem, ["readPaths", "writePaths"]) &&
    Array.isArray(filesystem.readPaths) &&
    Array.isArray(filesystem.writePaths) &&
    isRecord(network) &&
    exactKeys(network, ["allowed", "domains"]) &&
    typeof network.allowed === "boolean" &&
    Array.isArray(network.domains) &&
    isRecord(extensions) &&
    exactKeys(extensions, ["allowedIds"]) &&
    Array.isArray(extensions.allowedIds) &&
    isRecord(secrets) &&
    exactKeys(secrets, ["allowedNames"]) &&
    Array.isArray(secrets.allowedNames) &&
    (value.process === undefined ||
      (isRecord(value.process) &&
        exactKeys(value.process, ["allowed", "commands"]) &&
        typeof value.process.allowed === "boolean" &&
        Array.isArray(value.process.commands) &&
        value.process.commands.every(
          (command) =>
            isRecord(command) &&
            exactKeys(command, ["executable", "args"]) &&
            typeof command.executable === "string" &&
            Array.isArray(command.args) &&
            command.args.every((arg) => {
              if (!isRecord(arg) || typeof arg.kind !== "string") return false;
              if (arg.kind === "literal")
                return exactKeys(arg, ["kind", "value"]) && typeof arg.value === "string";
              return (
                arg.kind === "slot" &&
                exactKeys(arg, ["kind", "name", "valueType"]) &&
                typeof arg.name === "string" &&
                (arg.valueType === "uuid" ||
                  arg.valueType === "integer" ||
                  arg.valueType === "slug")
              );
            }),
        )))
  );
}

function parseTimestamp(iso: string | null): UTCTimestamp | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return ms as UTCTimestamp;
}

function parseTimestampStrict(iso: string | null | undefined): UTCTimestamp | undefined {
  if (iso === null || iso === undefined) return undefined;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return undefined;
  return ms as UTCTimestamp;
}

function toIso(ts: UTCTimestamp | null | undefined): string | null {
  if (ts === null || ts === undefined) return null;
  return new Date(ts).toISOString();
}

// ─── Job Codec ──────────────────

export function decodeJobRow(row: JobRow): Result<Job> {
  const createdAt = parseTimestamp(row.created_at);
  const updatedAt = parseTimestamp(row.updated_at);
  if (createdAt === null || updatedAt === null) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.DB_CORRUPT_ROW,
        message: "Job has invalid timestamps",
        meta: { id: row.id },
      }),
    );
  }

  let tags: string[];
  try {
    const parsedTags: unknown = JSON.parse(row.tags_json);
    if (
      !Array.isArray(parsedTags) ||
      parsedTags.length > 50 ||
      !parsedTags.every((tag) => typeof tag === "string" && tag.length <= 100)
    )
      throw new Error("tags must be bounded strings");
    tags = parsedTags;
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.DB_CORRUPT_ROW,
        message: "Job tags_json is malformed",
        meta: { id: row.id },
      }),
    );
  }

  // Parse schedule JSON
  let scheduleJson: { value: Record<string, unknown> };
  try {
    const parsed: unknown = JSON.parse(row.schedule_json);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      !isRecord(parsed.value) ||
      !isScheduleValue(parsed.value)
    )
      throw new Error("invalid persisted schedule");
    scheduleJson = parsed as { value: Record<string, unknown> };
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.DB_CORRUPT_ROW,
        message: "Job schedule_json is malformed",
        meta: { id: row.id },
      }),
    );
  }

  // Parse execution JSON
  let executionJson: {
    model: string;
    mode: string;
    workingDirectory: string;
    timeoutMs: number;
    maxOutputBytes: number;
    overlapPolicy: string;
    missedRunPolicy: string;
    sandboxRequired: boolean;
    completion?: import("../domain/permission.js").CompletionPolicy;
    environment: { values: Record<string, string>; secretNames: string[] };
  };
  try {
    const parsed: unknown = JSON.parse(row.execution_json);
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      typeof parsed.model !== "string" ||
      parsed.mode !== "subagent" ||
      typeof parsed.workingDirectory !== "string" ||
      typeof parsed.timeoutMs !== "number" ||
      typeof parsed.maxOutputBytes !== "number" ||
      parsed.overlapPolicy !== "skip" ||
      (parsed.missedRunPolicy !== "skip" && parsed.missedRunPolicy !== "run_once") ||
      typeof parsed.sandboxRequired !== "boolean" ||
      (parsed.completion !== undefined && !isCompletionValue(parsed.completion)) ||
      !isRecord(parsed.environment) ||
      !isRecord(parsed.environment.values) ||
      !Object.values(parsed.environment.values).every((value) => typeof value === "string") ||
      !Array.isArray(parsed.environment.secretNames) ||
      !parsed.environment.secretNames.every((name) => typeof name === "string")
    )
      throw new Error("invalid persisted execution");
    executionJson = parsed as typeof executionJson;
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.DB_CORRUPT_ROW,
        message: "Job execution_json is malformed",
        meta: { id: row.id },
      }),
    );
  }

  // Parse permissions JSON
  let permissionsParsed: { value: JobPermissions };
  try {
    const parsed: unknown = JSON.parse(row.permissions_json);
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isPermissionsValue(parsed.value))
      throw new Error("invalid persisted permissions");
    permissionsParsed = parsed as { value: JobPermissions };
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.DB_CORRUPT_ROW,
        message: "Job permissions_json is malformed",
        meta: { id: row.id },
      }),
    );
  }

  const job: Job = {
    id: row.id,
    revision: row.revision,
    schemaVersion: 1,
    definition: {
      name: row.name,
      description: row.description ?? undefined,
      tags,
      prompt: row.prompt,
      schedule: scheduleJson.value as unknown as Job["definition"]["schedule"],
      model: executionJson.model,
      identity: {
        scope: row.scope as Job["definition"]["identity"]["scope"],
        scopeKey: row.scope_key,
      },
      execution: {
        mode: executionJson.mode as "subagent",
        workingDirectory: executionJson.workingDirectory,
        timeoutMs: executionJson.timeoutMs,
        maxOutputBytes: executionJson.maxOutputBytes,
        overlapPolicy: executionJson.overlapPolicy as "skip",
        missedRunPolicy: executionJson.missedRunPolicy as "skip" | "run_once",
        sandboxRequired: executionJson.sandboxRequired,
        completion: executionJson.completion ?? { mode: "process_exit" },
        environment: executionJson.environment,
      },
      permissions: {
        ...permissionsParsed.value,
        process: permissionsParsed.value.process ?? { allowed: false, commands: [] },
      },
      source: row.source as Job["definition"]["source"],
      importKey: row.import_key ?? undefined,
    },
    status: row.status as Job["status"],
    fingerprint: "",
    approvedFingerprint: row.approved_fingerprint ?? undefined,
    approvedAt: parseTimestampStrict(row.approved_fingerprint ? row.updated_at : undefined),
    createdAt,
    createdBy: row.created_by,
    updatedAt,
    updatedBy: row.updated_by,
    nextRunAt: parseTimestamp(row.next_run_at),
    lastScheduledAt: parseTimestampStrict(row.last_scheduled_at),
    lastRunAt: parseTimestampStrict(row.last_run_at),
    lastSuccessAt: parseTimestampStrict(row.last_success_at),
    consecutiveFailures: row.consecutive_failures,
    diagnosticCode: row.diagnostic_code ?? undefined,
    diagnosticMessage: row.diagnostic_message ?? undefined,
  };

  return ok(job);
}

export function encodeJobRow(job: Job): JobRow {
  const scheduleJson = JSON.stringify({
    schemaVersion: 1,
    value: job.definition.schedule,
  });
  const executionJson = JSON.stringify({
    schemaVersion: 1,
    model: job.definition.model,
    mode: job.definition.execution.mode,
    workingDirectory: job.definition.execution.workingDirectory,
    timeoutMs: job.definition.execution.timeoutMs,
    maxOutputBytes: job.definition.execution.maxOutputBytes,
    overlapPolicy: job.definition.execution.overlapPolicy,
    missedRunPolicy: job.definition.execution.missedRunPolicy,
    sandboxRequired: job.definition.execution.sandboxRequired,
    completion: job.definition.execution.completion ?? { mode: "process_exit" },
    environment: job.definition.execution.environment,
  });
  const permissionsJson = JSON.stringify({
    schemaVersion: 1,
    value: {
      ...job.definition.permissions,
      process: job.definition.permissions.process ?? { allowed: false, commands: [] },
    },
  });

  return {
    id: job.id,
    schema_version: job.schemaVersion,
    name: job.definition.name,
    normalized_name: job.definition.name.toLowerCase(),
    description: job.definition.description ?? null,
    prompt: job.definition.prompt,
    tags_json: JSON.stringify(job.definition.tags),
    status: job.status,
    scope: job.definition.identity.scope,
    scope_key: job.definition.identity.scopeKey,
    source: job.definition.source,
    import_key: job.definition.importKey ?? null,
    schedule_json: scheduleJson,
    execution_json: executionJson,
    permissions_json: permissionsJson,
    approval_required: job.status === "pending_approval" ? 1 : 0,
    approved_fingerprint: job.approvedFingerprint ?? null,
    next_run_at: toIso(job.nextRunAt),
    last_scheduled_at: toIso(job.lastScheduledAt ?? null),
    last_run_at: toIso(job.lastRunAt ?? null),
    last_success_at: toIso(job.lastSuccessAt ?? null),
    consecutive_failures: job.consecutiveFailures,
    diagnostic_code: job.diagnosticCode ?? null,
    diagnostic_message: job.diagnosticMessage ?? null,
    created_at: new Date(job.createdAt).toISOString(),
    created_by: job.createdBy,
    updated_at: new Date(job.updatedAt).toISOString(),
    updated_by: job.updatedBy,
    revision: job.revision,
  };
}

// ─── Run Codec ──────────────────

export function decodeRunRow(row: RunRow): Result<Run> {
  const queuedAt = parseTimestamp(row.queued_at);
  const scheduledAt = parseTimestamp(row.scheduled_at);
  if (queuedAt === null || scheduledAt === null) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.DB_CORRUPT_ROW,
        message: "Run has invalid timestamps",
        meta: { id: row.id },
      }),
    );
  }

  let metadata: Record<string, unknown> = {};
  if (row.metadata_json !== null) {
    try {
      metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      return err(
        new ChronosError({
          code: ChronosErrorCode.DB_CORRUPT_ROW,
          message: "Run metadata_json is malformed",
          meta: { id: row.id },
        }),
      );
    }
  }

  const run: Run = {
    id: row.id,
    jobId: row.job_id,
    occurrenceKey: row.occurrence_key,
    occurrenceAt: scheduledAt,
    jobRevision: typeof metadata.jobRevision === "number" ? metadata.jobRevision : 0,
    status: row.status as RunStatus,
    trigger: row.trigger as "scheduled" | "manual",
    timing: {
      queuedAt,
      claimedAt: parseTimestampStrict(row.claimed_at),
      startedAt: parseTimestampStrict(row.started_at),
      finishedAt: parseTimestampStrict(row.finished_at),
    },
    ownerId: row.executor_id ?? undefined,
    leaseDeadline: parseTimestampStrict(row.lease_expires_at),
    failureCode: row.error_code ?? undefined,
    output:
      row.output_summary !== null
        ? {
            summary: row.output_summary,
            truncated: row.output_truncated === 1,
            totalBytes:
              typeof metadata.outputTotalBytes === "number" ? metadata.outputTotalBytes : 0,
            artifactPath: row.output_location ?? undefined,
            stopReason: typeof metadata.stopReason === "string" ? metadata.stopReason : undefined,
            toolActivity: Array.isArray(metadata.toolActivity)
              ? metadata.toolActivity.filter((item): item is string => typeof item === "string")
              : undefined,
            completionSummary:
              typeof metadata.completionSummary === "string"
                ? metadata.completionSummary
                : undefined,
            completionCategory:
              typeof metadata.completionCategory === "string"
                ? metadata.completionCategory
                : undefined,
            toolErrorCount:
              typeof metadata.toolErrorCount === "number" ? metadata.toolErrorCount : undefined,
          }
        : undefined,
    skipReason: undefined, // populated from metadata
    catchUpFirst: parseTimestampStrict(metadata.firstMissedAt as string | undefined),
    catchUpLast: parseTimestampStrict(metadata.lastMissedAt as string | undefined),
    catchUpCount: metadata.missedCount as number | undefined,
    events: [],
    attempt: row.attempt,
  };

  // Populate skip reason from error_code if applicable
  if (row.status === "skipped" && row.error_code) {
    run.skipReason = row.error_code as Run["skipReason"];
  }

  return ok(run);
}

export function encodeRunRow(run: Run): RunRow {
  const metadata: Record<string, unknown> = {};
  metadata.jobRevision = run.jobRevision;
  if (run.catchUpFirst !== undefined)
    metadata.firstMissedAt = new Date(run.catchUpFirst).toISOString();
  if (run.catchUpLast !== undefined)
    metadata.lastMissedAt = new Date(run.catchUpLast).toISOString();
  if (run.catchUpCount !== undefined) metadata.missedCount = run.catchUpCount;
  if (run.output?.totalBytes !== undefined) metadata.outputTotalBytes = run.output.totalBytes;
  if (run.output?.stopReason !== undefined) metadata.stopReason = run.output.stopReason;
  if (run.output?.toolActivity !== undefined)
    metadata.toolActivity = run.output.toolActivity.slice(0, 1_000);
  if (run.output?.completionSummary !== undefined)
    metadata.completionSummary = run.output.completionSummary.slice(0, 4_096);
  if (run.output?.completionCategory !== undefined)
    metadata.completionCategory = run.output.completionCategory.slice(0, 64);
  if (run.output?.toolErrorCount !== undefined)
    metadata.toolErrorCount = Math.max(0, Math.min(1_000, run.output.toolErrorCount));

  return {
    id: run.id,
    job_id: run.jobId,
    occurrence_key: run.occurrenceKey,
    trigger: run.trigger ?? "scheduled",
    scheduled_at: new Date(run.occurrenceAt).toISOString(),
    queued_at: new Date(run.timing.queuedAt).toISOString(),
    claimed_at: toIso(run.timing.claimedAt ?? null),
    started_at: toIso(run.timing.startedAt ?? null),
    finished_at: toIso(run.timing.finishedAt ?? null),
    status: run.status,
    attempt: run.attempt,
    executor_id: run.ownerId ?? null,
    lease_expires_at: toIso(run.leaseDeadline ?? null),
    parent_run_id: null,
    output_summary: run.output?.summary ?? null,
    output_location: run.output?.artifactPath ?? null,
    output_truncated: run.output?.truncated ? 1 : 0,
    error_code: run.failureCode ?? run.skipReason ?? null,
    error_message: null,
    error_details: null,
    metadata_json: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    duration_ms: null,
    created_at: new Date(run.timing.queuedAt).toISOString(),
  };
}

// ─── Approval Codec ─────────────────────

export function decodeApprovalRow(row: ApprovalRow): JobApproval {
  return {
    id: row.id,
    jobId: row.job_id,
    fingerprint: row.fingerprint,
    approvedBy: row.approved_by,
    approvedAt: parseTimestamp(row.approved_at) as UTCTimestamp,
    source: row.source as "tui" | "rpc",
    revokedAt: parseTimestampStrict(row.revoked_at),
  };
}

export function encodeApprovalRow(approval: JobApproval): ApprovalRow {
  return {
    id: approval.id,
    job_id: approval.jobId,
    fingerprint: approval.fingerprint,
    approved_by: approval.approvedBy,
    approved_at: new Date(approval.approvedAt).toISOString(),
    revoked_at: toIso(approval.revokedAt ?? null),
    source: approval.source,
  };
}

// ─── Instance Codec ─────────────────────

export function decodeInstanceRow(row: InstanceRow): SchedulerInstance {
  return {
    id: row.id,
    hostname: row.hostname ?? "unknown",
    processId: row.process_id ?? 0,
    startedAt: parseTimestamp(row.started_at) as UTCTimestamp,
    heartbeatAt: parseTimestamp(row.heartbeat_at) as UTCTimestamp,
    stoppedAt: parseTimestampStrict(row.stopped_at),
  };
}

export function encodeInstanceRow(instance: SchedulerInstance): InstanceRow {
  return {
    id: instance.id,
    hostname: instance.hostname,
    process_id: instance.processId,
    started_at: new Date(instance.startedAt).toISOString(),
    heartbeat_at: new Date(instance.heartbeatAt).toISOString(),
    stopped_at: toIso(instance.stoppedAt ?? null),
  };
}

// ─── Audit Codec ────────────────────────

export function decodeAuditRow(row: AuditRow): AuditEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.details_json) as Record<string, unknown>;
  } catch {
    payload = { raw: row.details_json };
  }

  return {
    id: row.id,
    type: row.event_name as AuditEventType,
    timestamp: parseTimestamp(row.timestamp) as UTCTimestamp,
    entityId: row.job_id ?? "",
    entityId2: row.run_id ?? undefined,
    actor: row.actor,
    payload,
    message: row.event_name,
  };
}

export function encodeAuditRow(event: AuditEvent): AuditRow {
  return {
    id: event.id,
    event_name: event.type,
    actor: event.actor,
    job_id: event.entityId || null,
    run_id: event.entityId2 || null,
    timestamp: new Date(event.timestamp).toISOString(),
    old_fingerprint: null,
    new_fingerprint: null,
    details_json: JSON.stringify(event.payload),
  };
}

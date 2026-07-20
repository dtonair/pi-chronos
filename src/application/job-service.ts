/**
 * Job application service.
 *
 * Orchestrates job lifecycle: create, get, list, update, pause, resume, archive, delete.
 *
 * Responsibilities:
 *   - Scoped name uniqueness (case-insensitive)
 *   - Revision compare-and-set for all mutations
 *   - Schedule normalization with once/past handling
 *   - Source-aware initial status (tool/import → pending_approval)
 *   - Atomic fingerprint recomputation and approval invalidation on security-relevant edits
 *   - Model resolution at creation time
 */
import type { AuditEvent } from "../domain/audit.js";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Job, JobDefinition, JobSchedule, JobStatus } from "../domain/job.js";
import type { JobPermissions } from "../domain/permission.js";
import { createCronCalculator } from "../scheduler/cron.js";
import { normalizeOnce } from "../scheduler/once.js";
import { isValidTransition, resolveInitialStatus } from "../security/approval-policy.js";
import { validateEnvironment } from "../security/environment-policy.js";
import { computeJobFingerprint, fingerprintsMatch } from "../security/job-fingerprint.js";
import type { Clock, EventSink, IdGenerator } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { appendAuditEvent, appendAuditEvents } from "../storage/repositories/audit-repository.js";
import {
  createJob as createJobRepo,
  deleteJob as deleteJobRepo,
  getJobById,
  listJobs,
  transitionJobStatus,
  updateJob,
} from "../storage/repositories/job-repository.js";
import { inImmediateTransaction } from "../storage/transaction.js";
import { validateCompletionPolicy, validateEffectivePermissions } from "./preview-service.js";

// ─── Job service interface ────────────────────────────

export interface JobServiceDeps {
  adapter: DatabaseAdapter;
  clock: Clock;
  ids: IdGenerator;
  defaultModel: string;
  events?: EventSink;
}

// ─── Create params ─────────────────────────────────────

export interface CreateJobParams {
  definition: Omit<JobDefinition, "model"> & { model?: string };
  actor: string;
  /** Whether the user explicitly requested approval review. */
  requestApproval?: boolean;
  /** Whether the creation context is privileged. */
  privileged?: boolean;
  /** Whether to allow a once schedule in the past. */
  allowPast?: boolean;
}

export interface UpdateJobParams {
  jobId: string;
  expectedRevision: number;
  patch: Partial<JobDefinition>;
  actor: string;
  allowPast?: boolean;
}

// ─── Create ────────────────────────────────────────────

export function createJobService(deps: JobServiceDeps) {
  const { adapter, clock, ids } = deps;

  function emit(type: import("../domain/events.js").DomainEvent["type"], job: Job): void {
    deps.events?.emit({
      type,
      timestamp: clock.now(),
      entityId: job.id,
      payload: { source: job.definition.source, status: job.status },
    });
  }

  function makeAuditEvent(
    type: AuditEvent["type"],
    job: Job,
    actor: string,
    payload: Record<string, unknown> = {},
  ): AuditEvent {
    return {
      id: ids.generate(),
      type,
      timestamp: clock.now(),
      entityId: job.id,
      actor,
      payload,
      message: `Job ${job.definition.name}: ${type}`,
    };
  }

  /**
   * Create a new job. Enforces scoped name uniqueness, resolves the initial
   * status from the source and context, computes the fingerprint, and persists.
   */
  function createJob(params: CreateJobParams): Result<Job> {
    const now = clock.now();

    // Resolve model: require explicit model or use default
    const model = params.definition.model ?? deps.defaultModel;

    // Validate model is non-empty
    if (!model || model.trim().length === 0) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.VALIDATION_ERROR,
          message: "Model is required and cannot be empty",
        }),
      );
    }

    const normalizedSchedule = normalizeSchedule(
      params.definition.schedule,
      now,
      params.allowPast ?? false,
    );
    if (!normalizedSchedule.ok) return err(normalizedSchedule.error);

    const definition: JobDefinition = {
      ...params.definition,
      schedule: normalizedSchedule.value,
      model,
      tags: params.definition.tags ?? [],
      description: params.definition.description,
      identity: {
        scope: params.definition.identity?.scope ?? "user",
        scopeKey: params.definition.identity?.scopeKey ?? params.actor,
      },
      execution: {
        mode: "subagent",
        workingDirectory: params.definition.execution?.workingDirectory ?? process.cwd(),
        timeoutMs: params.definition.execution?.timeoutMs ?? 600_000,
        maxOutputBytes: params.definition.execution?.maxOutputBytes ?? 262_144,
        overlapPolicy: params.definition.execution?.overlapPolicy ?? "skip",
        missedRunPolicy: params.definition.execution?.missedRunPolicy ?? "skip",
        sandboxRequired: params.definition.execution?.sandboxRequired ?? false,
        completion: params.definition.execution?.completion ?? {
          mode: "explicit",
          requiredOutputs: [],
        },
        environment: params.definition.execution?.environment ?? {
          values: {},
          secretNames: [],
        },
      },
      permissions: normalizePermissions(params.definition.permissions),
      source: params.definition.source ?? "direct_user",
      importKey: params.definition.importKey,
    };

    const permissions = validateEffectivePermissions(definition.permissions);
    if (!permissions.ok) return err(permissions.error);
    const completion = validateCompletionPolicy(definition.execution.completion);
    if (!completion.ok) return err(completion.error);
    const environment = validateEnvironment(
      definition.execution.environment,
      definition.permissions,
    );
    if (!environment.ok) return err(environment.error);

    // Validate source is not "tool" for direct API calls — tool source
    // is only set when the scheduler tool is the origin.
    // For regular creation, if source is not set, it defaults to direct_user.

    // Compute initial status
    const initialStatus = resolveInitialStatus({
      source: definition.source,
      requestApproval: params.requestApproval ?? definition.source !== "direct_user",
      privileged: params.privileged ?? false,
    });

    // Compute fingerprint
    const fingerprint = computeJobFingerprint(definition);

    const initialNextRunAt =
      params.allowPast === true && normalizedSchedule.value.kind === "once"
        ? (Date.parse(normalizedSchedule.value.runAt) as import("../domain/job.js").UTCTimestamp)
        : null;
    const job: Job = {
      id: ids.generate(),
      revision: 1,
      schemaVersion: 1,
      definition,
      status: initialStatus,
      fingerprint,
      approvedFingerprint: undefined,
      createdAt: now,
      createdBy: params.actor,
      updatedAt: now,
      updatedBy: params.actor,
      nextRunAt: initialNextRunAt,
      consecutiveFailures: 0,
    };

    const result = createJobRepo(adapter, job);
    if (!result.ok) return result;

    // Record audit event
    appendAuditEvent(
      adapter,
      makeAuditEvent("job.created", job, params.actor, {
        status: initialStatus,
        fingerprint,
        source: definition.source,
      }),
    );
    emit("job.created", job);

    return ok(job);
  }

  // ─── Get ──────────────────────────────────────

  function getJob(id: string): Result<Job | undefined> {
    return getJobById(adapter, id);
  }

  // ─── List ─────────────────────────────────────

  function listUserJobs(params: {
    scope?: Job["definition"]["identity"]["scope"];
    scopeKey?: string;
    status?: JobStatus;
    cursor?: string;
    limit?: number;
  }): Result<{ jobs: Job[]; nextCursor?: string }> {
    return listJobs(adapter, {
      scope: params.scope,
      scopeKey: params.scopeKey,
      status: params.status,
      cursor: params.cursor,
      limit: params.limit,
    });
  }

  // ─── Update ───────────────────────────────────

  /**
   * Update a job's definition fields.
   *
   * Rules:
   *   - stale revisions (concurrent modification) fail with REVISION_CONFLICT
   *   - display-only changes (description, tags) retain approval
   *   - security-relevant changes invalidate approval atomically in the same transaction
   *   - null-clearing a field (e.g. description) works
   *   - no partial updates: the entire patch is applied or nothing
   */
  function updateExistingJob(params: UpdateJobParams): Result<Job> {
    let approvalInvalidated = false;
    const result = updateJob(adapter, params.jobId, params.expectedRevision, (existingJob) => {
      const patch = params.patch;

      // Merge the patch into the definition
      const updatedDefinition: JobDefinition = {
        ...existingJob.definition,
      };

      // Apply each patch field
      if (patch.name !== undefined) updatedDefinition.name = patch.name;
      if ("description" in patch) updatedDefinition.description = patch.description ?? undefined;
      if (patch.tags !== undefined) updatedDefinition.tags = patch.tags;
      if (patch.prompt !== undefined) updatedDefinition.prompt = patch.prompt;
      if (patch.schedule !== undefined) {
        const normalizedSchedule = normalizeSchedule(
          patch.schedule,
          clock.now(),
          params.allowPast ?? false,
        );
        if (!normalizedSchedule.ok) return err(normalizedSchedule.error);
        updatedDefinition.schedule = normalizedSchedule.value;
        existingJob.nextRunAt =
          params.allowPast === true && normalizedSchedule.value.kind === "once"
            ? (Date.parse(
                normalizedSchedule.value.runAt,
              ) as import("../domain/job.js").UTCTimestamp)
            : null;
      }
      if (patch.model !== undefined) updatedDefinition.model = patch.model;
      if (patch.identity !== undefined) updatedDefinition.identity = patch.identity;
      if (patch.execution !== undefined) {
        updatedDefinition.execution = {
          ...updatedDefinition.execution,
          ...patch.execution,
          // Ensure nested objects are merged correctly
          environment: patch.execution.environment
            ? {
                ...updatedDefinition.execution.environment,
                ...patch.execution.environment,
                values: {
                  ...updatedDefinition.execution.environment.values,
                  ...patch.execution.environment.values,
                },
                secretNames:
                  patch.execution.environment.secretNames ??
                  updatedDefinition.execution.environment.secretNames,
              }
            : updatedDefinition.execution.environment,
        };
      }
      if (patch.permissions !== undefined)
        updatedDefinition.permissions = normalizePermissions(patch.permissions);
      const permissions = validateEffectivePermissions(updatedDefinition.permissions);
      if (!permissions.ok) return err(permissions.error);
      const completion = validateCompletionPolicy(updatedDefinition.execution.completion);
      if (!completion.ok) return err(completion.error);
      const environment = validateEnvironment(
        updatedDefinition.execution.environment,
        updatedDefinition.permissions,
      );
      if (!environment.ok) return err(environment.error);
      if (patch.source !== undefined) updatedDefinition.source = patch.source;
      if ("importKey" in patch) updatedDefinition.importKey = patch.importKey;

      // Recompute fingerprint
      const newFingerprint = computeJobFingerprint(updatedDefinition);

      // Determine if approval should be invalidated
      const hadApproval = existingJob.approvedFingerprint !== undefined;
      const fingerprintChanged = !fingerprintsMatch(
        newFingerprint,
        existingJob.approvedFingerprint ?? existingJob.fingerprint,
      );

      // Update the job
      existingJob.definition = updatedDefinition;
      existingJob.fingerprint = newFingerprint;
      existingJob.updatedAt = clock.now();
      existingJob.updatedBy = params.actor;

      if (hadApproval && fingerprintChanged) {
        approvalInvalidated = true;
        // Revoke the historical approval and clear the dispatch gate in the
        // same repository transaction as the definition update.
        adapter.run(
          "UPDATE job_approvals SET revoked_at = ? WHERE job_id = ? AND revoked_at IS NULL",
          new Date(clock.now()).toISOString(),
          existingJob.id,
        );
        existingJob.approvedFingerprint = undefined;
        existingJob.approvedAt = undefined;

        // If the job was active, revert to pending_approval
        if (existingJob.status === "active") {
          existingJob.status = "pending_approval";
        }
      }

      return ok(existingJob);
    });

    if (!result.ok) return result;

    // Record audit events
    const updated = result.value;
    const auditEvents: AuditEvent[] = [
      makeAuditEvent("job.updated", updated, params.actor, {
        patch: Object.keys(params.patch),
      }),
    ];

    if (approvalInvalidated) {
      auditEvents.push(
        makeAuditEvent("approval.invalidated", updated, params.actor, {
          reason: "Fingerprint changed due to security-relevant update",
        }),
      );
    }

    appendAuditEvents(adapter, auditEvents);
    emit("job.updated", updated);
    if (approvalInvalidated) {
      emit("job.fingerprint_changed", updated);
      emit("job.approval_invalidated", updated);
    }

    return ok(updated);
  }

  // ─── Status transitions ─────────────────────────

  function changeJobStatus(
    id: string,
    expectedRevision: number,
    newStatus: JobStatus,
    actor: string,
  ): Result<Job> {
    const before = getJobById(adapter, id);
    if (!before.ok) return before;
    if (before.value === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.JOB_NOT_FOUND,
          message: `Job not found: ${id}`,
          entity: id,
        }),
      );
    }
    if (!isValidTransition(before.value.status, newStatus)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.UNSUPPORTED_OPERATION,
          message: `Cannot transition job from ${before.value.status} to ${newStatus}`,
          entity: id,
        }),
      );
    }
    const result = transitionJobStatus(
      adapter,
      id,
      expectedRevision,
      newStatus,
      actor,
      clock.now(),
    );
    if (!result.ok) return result;

    const job = result.value;
    const eventType = statusToEventType(newStatus);
    appendAuditEvent(
      adapter,
      makeAuditEvent(eventType, job, actor, {
        from: before.value.status,
        to: newStatus,
      }),
    );
    emit("job.status_changed", job);

    return ok(job);
  }

  function pauseJob(id: string, expectedRevision: number, actor: string): Result<Job> {
    return changeJobStatus(id, expectedRevision, "paused", actor);
  }

  function resumeJob(id: string, expectedRevision: number, actor: string): Result<Job> {
    return changeJobStatus(id, expectedRevision, "active", actor);
  }

  function archiveJob(id: string, expectedRevision: number, actor: string): Result<Job> {
    return changeJobStatus(id, expectedRevision, "archived", actor);
  }

  function disableJob(id: string, expectedRevision: number, actor: string): Result<Job> {
    const result = transitionJobStatus(
      adapter,
      id,
      expectedRevision,
      "disabled",
      actor,
      clock.now(),
      { code: ChronosErrorCode.IMPORT_SOURCE_MISSING, message: "Import definition is missing" },
    );
    if (!result.ok) return result;
    const job = result.value;
    appendAuditEvent(
      adapter,
      makeAuditEvent("job.disabled", job, actor, {
        code: ChronosErrorCode.IMPORT_SOURCE_MISSING,
      }),
    );
    emit("job.status_changed", job);
    return ok(job);
  }

  function deleteJob(id: string, expectedRevision: number, actor: string): Result<void> {
    const current = getJobById(adapter, id);
    if (!current.ok) return current;
    if (current.value === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.JOB_NOT_FOUND,
          message: `Job not found: ${id}`,
          entity: id,
        }),
      );
    }
    const deleted = deleteJobRepo(adapter, id, expectedRevision);
    if (!deleted.ok) return deleted;
    appendAuditEvent(
      adapter,
      makeAuditEvent("job.deleted", current.value, actor, { revision: expectedRevision }),
    );
    emit("job.status_changed", { ...current.value, status: "archived" });
    return ok(undefined);
  }

  return {
    createJob,
    getJob,
    listUserJobs,
    updateExistingJob,
    pauseJob,
    resumeJob,
    archiveJob,
    disableJob,
    deleteJob,
    transaction<T>(fn: () => Result<T>): Result<T> {
      return inImmediateTransaction(adapter, fn);
    },
  };
}

// ─── Helpers ──────────────────────────────────────────

function normalizePermissions(permissions: Partial<JobPermissions> | undefined): JobPermissions {
  return {
    tools: permissions?.tools ?? ["read", "grep", "find", "ls"],
    shell: permissions?.shell ?? { allowed: false, commands: [] },
    filesystem: permissions?.filesystem ?? { readPaths: [], writePaths: [] },
    network: permissions?.network ?? { allowed: false, domains: [] },
    extensions: permissions?.extensions ?? { allowedIds: [] },
    secrets: permissions?.secrets ?? { allowedNames: [] },
    process: permissions?.process ?? { allowed: false, commands: [] },
  };
}

function normalizeSchedule(
  schedule: JobSchedule,
  now: import("../domain/job.js").UTCTimestamp,
  allowPast: boolean,
): Result<JobSchedule> {
  if (schedule.kind === "once") {
    const normalized = normalizeOnce(schedule, now, allowPast);
    if (!normalized.ok) return normalized;
    return ok({
      kind: "once",
      runAt: normalized.value.runAt,
      timezone: normalized.value.timezone,
    });
  }
  if (schedule.kind === "interval") {
    if (!Number.isInteger(schedule.everyMs) || schedule.everyMs <= 0) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.INVALID_SCHEDULE,
          message: "Interval must be a positive integer",
        }),
      );
    }
    if (schedule.anchorAt !== undefined && Number.isNaN(Date.parse(schedule.anchorAt))) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.INVALID_SCHEDULE,
          message: "Interval anchorAt must be ISO 8601",
        }),
      );
    }
    // An omitted anchor is resolved from the creation clock by the scheduler
    // when it first materializes next_run_at; keep the portable definition
    // unchanged so its fingerprint remains stable across imports.
    return ok(schedule);
  }
  const cron = createCronCalculator().validate(schedule.expression);
  if (!cron.ok) return cron;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone }).format(0);
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.TIMEZONE_INVALID,
        message: `Invalid IANA timezone: ${schedule.timezone}`,
        entity: schedule.timezone,
      }),
    );
  }
  return ok({ ...schedule, expression: cron.value.expression });
}

function statusToEventType(status: JobStatus): AuditEvent["type"] {
  switch (status) {
    case "paused":
      return "job.paused";
    case "active":
      return "job.resumed";
    case "archived":
      return "job.archived";
    case "disabled":
      return "job.disabled";
    default:
      return "job.updated";
  }
}

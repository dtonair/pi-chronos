import type { createApprovalService } from "../application/approval-service.js";
import type { createJobService } from "../application/job-service.js";
import { previewJobSchedule } from "../application/preview-service.js";
import type { createRunService } from "../application/run-service.js";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import { createCronCalculator } from "../scheduler/cron.js";
import type { Clock } from "../shared/ports.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { listRuns } from "../storage/repositories/run-repository.js";
import { SchedulerAction, type SchedulerResult, toSchedulerError } from "./result.js";
import type { SchedulerToolInput } from "./schemas.js";
import { decodeSchedulerToolInput } from "./schemas.js";

export interface ActionRouterDeps {
  jobs: ReturnType<typeof createJobService>;
  approvals: ReturnType<typeof createApprovalService>;
  runs: ReturnType<typeof createRunService>;
  clock: Clock;
  adapter: DatabaseAdapter;
  health?: () => unknown;
  onMutation?: () => void;
  importProject?: (
    cwd: string,
    actor: string,
    trusted: boolean,
  ) => Promise<import("../shared/result.js").Result<unknown>>;
}

const MUTATING_ACTIONS = new Set<SchedulerAction>([
  SchedulerAction.CREATE,
  SchedulerAction.UPDATE,
  SchedulerAction.PAUSE,
  SchedulerAction.RESUME,
  SchedulerAction.ARCHIVE,
  SchedulerAction.DELETE,
  SchedulerAction.RUN_NOW,
  SchedulerAction.CANCEL_RUN,
  SchedulerAction.APPROVE,
  SchedulerAction.REVOKE_APPROVAL,
  SchedulerAction.IMPORT,
]);

export function createActionRouter(deps: ActionRouterDeps) {
  async function route(
    value: unknown,
    actor: string,
    mode: "tui" | "rpc" | "json" | "print",
    context: { cwd?: string; trustedProject?: boolean; source?: "tool" | "direct_user" } = {},
  ): Promise<SchedulerResult> {
    const decoded = decodeSchedulerToolInput(value);
    if (!decoded.ok) return toSchedulerError(decoded.error);
    const input = decoded.value;
    try {
      const result = await dispatch(input, actor, mode, context);
      if (result.ok && MUTATING_ACTIONS.has(input.action)) deps.onMutation?.();
      return result;
    } catch (error) {
      return toSchedulerError(
        error instanceof ChronosError
          ? error
          : new ChronosError({
              code: ChronosErrorCode.INTERNAL_ERROR,
              message: error instanceof Error ? error.message : String(error),
              cause: error,
            }),
      );
    }
  }

  async function dispatch(
    input: SchedulerToolInput,
    actor: string,
    mode: "tui" | "rpc" | "json" | "print",
    context: { cwd?: string; trustedProject?: boolean; source?: "tool" | "direct_user" },
  ): Promise<SchedulerResult> {
    switch (input.action) {
      case SchedulerAction.PREVIEW: {
        if (!input.schedule)
          return {
            ok: false,
            error: { code: "VALIDATION_ERROR", message: "schedule is required" },
          };
        const result = previewJobSchedule({
          schedule: input.schedule,
          clockNow: deps.clock.now(),
          cronCalc: createCronCalculator(),
        });
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.CREATE: {
        if (!input.name || !input.prompt || !input.schedule)
          return {
            ok: false,
            error: { code: "VALIDATION_ERROR", message: "name, prompt, and schedule are required" },
          };
        const result = deps.jobs.createJob({
          actor,
          requestApproval: input.requestApproval,
          allowPast: input.allowPast,
          definition: {
            name: input.name,
            description: input.description,
            tags: input.tags ?? [],
            prompt: input.prompt,
            schedule: input.schedule,
            model: input.model,
            identity: { scope: input.scope ?? "user", scopeKey: actor },
            execution: (input.execution === undefined && context.cwd === undefined
              ? undefined
              : {
                  ...input.execution,
                  ...(context.cwd === undefined || input.execution?.workingDirectory !== undefined
                    ? {}
                    : { workingDirectory: context.cwd }),
                }) as never,
            permissions: input.permissions as never,
            source: context.source ?? "tool",
          },
        });
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.GET: {
        const result = deps.jobs.getJob(input.jobId ?? "");
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.LIST: {
        const result = deps.jobs.listUserJobs({
          scope: input.scope,
          scopeKey: actor,
          cursor: input.cursor,
          limit: input.limit,
        });
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.UPDATE: {
        const result = deps.jobs.updateExistingJob({
          jobId: input.jobId ?? "",
          expectedRevision: input.expectedRevision ?? 0,
          patch: input.patch as never,
          actor,
        });
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.PAUSE:
      case SchedulerAction.RESUME:
      case SchedulerAction.ARCHIVE:
      case SchedulerAction.DELETE: {
        const id = input.jobId ?? "";
        const current = deps.jobs.getJob(id);
        const revision =
          input.expectedRevision ?? (current.ok && current.value ? current.value.revision : 0);
        const result =
          input.action === SchedulerAction.PAUSE
            ? deps.jobs.pauseJob(id, revision, actor)
            : input.action === SchedulerAction.RESUME
              ? deps.jobs.resumeJob(id, revision, actor)
              : input.action === SchedulerAction.ARCHIVE
                ? deps.jobs.archiveJob(id, revision, actor)
                : deps.jobs.deleteJob(id, revision, actor);
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.RUN_NOW: {
        const result = deps.runs.runNow(input.jobId ?? "", actor, input.overridePaused);
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.CANCEL_RUN: {
        const result = deps.runs.cancelRun(input.runId ?? "", actor);
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.APPROVE: {
        if (mode === "print" || mode === "json")
          return {
            ok: false,
            error: {
              code: "INTERACTIVE_APPROVAL_REQUIRED",
              message: "Approval requires TUI or RPC confirmation",
            },
          };
        const job = deps.jobs.getJob(input.jobId ?? "");
        if (!job.ok || !job.value)
          return { ok: false, error: { code: "JOB_NOT_FOUND", message: "Job not found" } };
        const result = deps.approvals.approveJob({
          jobId: job.value.id,
          fingerprint: input.fingerprint ?? job.value.fingerprint,
          actor,
          source: mode === "tui" ? "tui" : "rpc",
          confirmationToken: input.confirmationToken ?? "",
        });
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.HISTORY: {
        const result = listRuns(deps.adapter, {
          jobId: input.jobId,
          cursor: input.cursor,
          limit: input.limit,
        });
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.IMPORT: {
        if (!deps.importProject || !context.cwd)
          return {
            ok: false,
            error: { code: "IMPORT_ERROR", message: "Import adapter is unavailable" },
          };
        const result = await deps.importProject(
          context.cwd,
          actor,
          context.trustedProject === true,
        );
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      case SchedulerAction.HEALTH: {
        if (deps.health !== undefined) return { ok: true, data: deps.health() };
        const queued =
          deps.adapter.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM job_runs WHERE status = 'queued'",
          )?.count ?? 0;
        return {
          ok: true,
          data: {
            databaseState: "ready",
            timerState: "armed",
            queueDepth: queued,
            enforcement: { toolAndPathPolicy: "active", osSandbox: "disabled" },
          },
        };
      }
      case SchedulerAction.REVOKE_APPROVAL: {
        if (mode === "print" || mode === "json")
          return {
            ok: false,
            error: {
              code: "INTERACTIVE_APPROVAL_REQUIRED",
              message: "Revocation requires TUI or RPC confirmation",
            },
          };
        const result = deps.approvals.revokeApproval(
          input.jobId ?? "",
          actor,
          mode === "tui" ? "tui" : "rpc",
          input.confirmationToken ?? "",
        );
        return result.ok ? { ok: true, data: result.value } : toSchedulerError(result.error);
      }
      default:
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED_OPERATION",
            message: `Action not implemented: ${input.action}`,
          },
        };
    }
  }
  return { route };
}

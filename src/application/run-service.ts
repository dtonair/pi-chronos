import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Run } from "../domain/run.js";
import type { Clock, IdGenerator } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { getJobById } from "../storage/repositories/job-repository.js";
import {
  createRun,
  getRunById,
  transitionRunStatus,
} from "../storage/repositories/run-repository.js";

export function createRunService(deps: {
  adapter: DatabaseAdapter;
  clock: Clock;
  ids: IdGenerator;
  requestCancel?: (runId: string) => boolean;
}) {
  function runNow(jobId: string, actor: string, overridePaused = false): Result<Run> {
    const jobResult = getJobById(deps.adapter, jobId);
    if (!jobResult.ok) return jobResult;
    const job = jobResult.value;
    if (!job)
      return err(
        new ChronosError({
          code: ChronosErrorCode.JOB_NOT_FOUND,
          message: "Job not found",
          entity: jobId,
        }),
      );
    if (job.status === "paused" && !overridePaused)
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: "Job is paused",
          entity: jobId,
        }),
      );
    if (!["active", "paused"].includes(job.status))
      return err(
        new ChronosError({
          code: ChronosErrorCode.APPROVAL_REQUIRED,
          message: "Job is not executable",
          entity: jobId,
        }),
      );
    const now = deps.clock.now();
    const run: Run = {
      id: deps.ids.generate(),
      jobId,
      occurrenceKey: `manual:${now}:${deps.ids.generate()}`,
      occurrenceAt: now,
      jobRevision: job.revision,
      trigger: "manual",
      attempt: 1,
      status: "queued",
      timing: { queuedAt: now },
      events: [{ timestamp: now, status: "queued", message: `manual trigger by ${actor}` }],
    };
    return createRun(deps.adapter, run);
  }

  function cancelRun(runId: string, actor: string): Result<Run> {
    const result = getRunById(deps.adapter, runId);
    if (!result.ok) return result;
    const run = result.value;
    if (!run)
      return err(
        new ChronosError({
          code: ChronosErrorCode.RUN_NOT_FOUND,
          message: "Run not found",
          entity: runId,
        }),
      );
    if (run.status === "claimed" || run.status === "running") {
      if (deps.requestCancel?.(runId) !== true) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.RUN_NOT_OWNED,
            message: "The active executor could not be contacted for cancellation",
            entity: runId,
          }),
        );
      }
      // The owner will persist the terminal cancelled transition after the
      // child observes AbortSignal. Do not bypass the ownership CAS here.
      return ok(run);
    }
    return transitionRunStatus(deps.adapter, runId, undefined, "cancelled", deps.clock.now(), {
      error: `cancelled by ${actor}`,
    });
  }

  return { runNow, cancelRun };
}

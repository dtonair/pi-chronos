import type { Job } from "../domain/job.js";
import type { Run } from "../domain/run.js";

/** Structured provenance is sent on stdin; secrets and policy internals stay out. */
export function buildChildContext(job: Job, run: Run): string {
  return JSON.stringify({
    chronos: {
      runId: run.id,
      jobId: job.id,
      occurrenceKey: run.occurrenceKey,
      scheduledAt: new Date(run.occurrenceAt).toISOString(),
    },
    prompt: job.definition.prompt,
    provenance: {
      source: job.definition.source,
      jobRevision: run.jobRevision,
      model: job.definition.model,
    },
  });
}

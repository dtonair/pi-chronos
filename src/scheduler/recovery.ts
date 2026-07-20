import type { UTCTimestamp } from "../domain/job.js";
import type { Clock, EventSink, IdGenerator } from "../shared/ports.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { appendAuditEvent } from "../storage/repositories/audit-repository.js";
import { getStaleInstances } from "../storage/repositories/instance-repository.js";
import {
  getRunsNeedingRecovery,
  transitionRunStatus,
} from "../storage/repositories/run-repository.js";

export interface RecoveryOptions {
  adapter: DatabaseAdapter;
  clock: Clock;
  ids: IdGenerator;
  events?: EventSink;
  ownerStaleMs?: number;
}

/** Recover only runs whose lease and scheduler owner are both stale. */
export function recoverStaleRuns(options: RecoveryOptions): { recovered: number; ignored: number } {
  const now = options.clock.now();
  options.events?.emit({ type: "recovery.start", timestamp: now });
  const staleAfter = (now - Math.max(1_000, options.ownerStaleMs ?? 30_000)) as UTCTimestamp;
  const staleOwners = new Set(
    getStaleInstances(options.adapter, staleAfter).map((item) => item.id),
  );
  const candidates = getRunsNeedingRecovery(options.adapter, now);
  let recovered = 0;
  let ignored = 0;
  for (const run of candidates) {
    if (!run.ownerId || !staleOwners.has(run.ownerId)) {
      ignored++;
      continue;
    }
    const result = transitionRunStatus(options.adapter, run.id, run.ownerId, "abandoned", now, {
      recover: true,
    });
    if (!result.ok) continue;
    recovered++;
    appendAuditEvent(options.adapter, {
      id: options.ids.generate(),
      type: "recovery.stale_run",
      timestamp: now,
      entityId: run.jobId,
      entityId2: run.id,
      actor: "recovery",
      payload: { code: "EXECUTOR_LEASE_EXPIRED", ownerId: run.ownerId },
      message: "Run abandoned after executor lease and owner heartbeat expired",
    });
    options.events?.emit({
      type: "recovery.stale_run",
      timestamp: now,
      entityId: run.id,
      entityId2: run.jobId,
      status: "abandoned",
      error: "EXECUTOR_LEASE_EXPIRED",
    });
  }
  options.events?.emit({
    type: "recovery.complete",
    timestamp: now,
    payload: { recovered, ignored },
  });
  return { recovered, ignored };
}

export function createRecoveryCoordinator(options: RecoveryOptions) {
  return { recover: () => recoverStaleRuns(options) };
}

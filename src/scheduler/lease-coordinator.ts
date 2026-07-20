import type { UTCTimestamp } from "../domain/job.js";
import type { Clock, ClockTimer, EventSink } from "../shared/ports.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { listOwnedActiveRuns, renewRunLease } from "../storage/repositories/run-repository.js";

export interface LeaseCoordinatorOptions {
  adapter: DatabaseAdapter;
  clock: Clock;
  ownerId: string;
  leaseMs?: number;
  renewEveryMs?: number;
  events?: EventSink;
}

/** Renews all owned active runs from one bounded timer. */
export function createLeaseCoordinator(options: LeaseCoordinatorOptions) {
  const leaseMs = Math.max(1_000, options.leaseMs ?? 60_000);
  const renewEveryMs = Math.max(500, options.renewEveryMs ?? Math.floor(leaseMs / 3));
  let timer: ClockTimer | undefined;
  let stopped = true;

  function renew(): void {
    if (stopped) return;
    const deadline = (options.clock.now() + leaseMs) as UTCTimestamp;
    for (const run of listOwnedActiveRuns(options.adapter, options.ownerId)) {
      try {
        const result = renewRunLease(options.adapter, run.id, options.ownerId, deadline);
        options.events?.emit({
          type: result.ok ? "run.lease_renewed" : "run.lease_expired",
          timestamp: options.clock.now(),
          instanceId: options.ownerId,
          entityId: run.id,
          error: result.ok ? undefined : result.error.message,
        });
      } catch (error) {
        options.events?.emit({
          type: "run.lease_expired",
          timestamp: options.clock.now(),
          instanceId: options.ownerId,
          entityId: run.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    timer = options.clock.setTimeout(renew, renewEveryMs);
  }

  function start(): void {
    if (!stopped) return;
    stopped = false;
    timer = options.clock.setTimeout(renew, renewEveryMs);
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    timer?.clear();
    timer = undefined;
  }

  return {
    start,
    stop,
    renew,
    get running(): boolean {
      return !stopped;
    },
  };
}

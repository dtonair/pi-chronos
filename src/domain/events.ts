import type { UTCTimestamp } from "./job.js";
import type { RunStatus, SkipReason } from "./run.js";

export type DomainEventType =
  // Scheduler lifecycle
  | "scheduler.wake"
  | "scheduler.dispatch"
  | "scheduler.skip"
  | "scheduler.catch_up"
  | "scheduler.queue_depth"
  | "scheduler.error"
  | "scheduler.timer_armed"
  | "scheduler.timer_cleared"
  | "scheduler.timer_fired"
  // Job events
  | "job.created"
  | "job.updated"
  | "job.status_changed"
  | "job.fingerprint_changed"
  | "job.approved"
  | "job.revoked"
  | "job.approval_invalidated"
  // Run events
  | "run.dispatched"
  | "run.claimed"
  | "run.started"
  | "run.finished"
  | "run.lease_renewed"
  | "run.lease_expired"
  // Instance events
  | "instance.registered"
  | "instance.heartbeat"
  | "instance.heartbeat_lost"
  | "instance.stopped"
  // Recovery
  | "recovery.start"
  | "recovery.stale_run"
  | "recovery.complete"
  // Import
  | "import.applied"
  | "import.disabled"
  | "import.reconciled"
  // Policy
  | "policy.denied"
  | "policy.manifest_created"
  | "policy.manifest_deleted";

export interface DomainEvent {
  type: DomainEventType;
  timestamp: UTCTimestamp;
  /** Scheduler instance id. */
  instanceId?: string;
  /** Primary entity id. */
  entityId?: string;
  /** Secondary entity id. */
  entityId2?: string;
  /** For run events: the run status. */
  status?: RunStatus;
  /** For skip events. */
  skipReason?: SkipReason;
  /** For catch-up events. */
  catchUpCount?: number;
  /** For queue depth events. */
  depth?: number;
  /** Arbitrary payload. */
  payload?: Record<string, unknown>;
  /** Error information. */
  error?: string;
}

import type { UTCTimestamp } from "./job.js";

export type AuditEventType =
  | "job.created"
  | "job.updated"
  | "job.paused"
  | "job.resumed"
  | "job.archived"
  | "job.deleted"
  | "job.disabled"
  | "approval.approved"
  | "approval.revoked"
  | "approval.invalidated"
  | "run.queued"
  | "run.claimed"
  | "run.started"
  | "run.succeeded"
  | "run.failed"
  | "run.timed_out"
  | "run.cancelled"
  | "run.abandoned"
  | "run.skipped"
  | "import.applied"
  | "import.disabled"
  | "instance.registered"
  | "instance.stopped"
  | "instance.heartbeat_lost"
  | "recovery.stale_run"
  | "policy.denied";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: UTCTimestamp;
  /** Subject entity id (job, run, instance). */
  entityId: string;
  /** Optional second entity id (e.g. run for a job event). */
  entityId2?: string;
  /** Actor identity (user, system, instance id). */
  actor: string;
  /** Structured payload specific to the event type. */
  payload: Record<string, unknown>;
  /** Human-readable summary. */
  message: string;
}

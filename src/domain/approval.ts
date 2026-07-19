import type { UTCTimestamp } from "./job.js";

export type ApprovalAction = "approved" | "revoked";

export interface ApprovalEvent {
  id: string;
  jobId: string;
  action: ApprovalAction;
  /** The fingerprint at decision time. */
  fingerprint: string;
  /** User or system identity that approved/revoked. */
  actor: string;
  /** Confirmation token from user interaction. */
  confirmationToken?: string;
  /** Audit timestamp. */
  timestamp: UTCTimestamp;
  /** Human-readable reason. */
  reason?: string;
}

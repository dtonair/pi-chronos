import type { UTCTimestamp } from "./job.js";

export type ApprovalSource = "tui" | "rpc";

/** Persisted approval record. Interactive confirmation tokens are deliberately not persisted. */
export interface JobApproval {
  readonly id: string;
  readonly jobId: string;
  readonly fingerprint: string;
  readonly approvedBy: string;
  readonly approvedAt: UTCTimestamp;
  readonly source: ApprovalSource;
  readonly revokedAt?: UTCTimestamp;
}

export interface ApprovalDecision {
  jobId: string;
  fingerprint: string;
  actor: string;
  source: ApprovalSource;
  confirmationToken: string;
}

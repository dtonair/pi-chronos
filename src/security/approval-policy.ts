/**
 * Approval policy and source-aware authorization rules.
 *
 * FR50-FR57:
 *   - Tool-created jobs are inert until approved.
 *   - Project-imported jobs are inert until approved.
 *   - Non-privileged direct-user creation may activate immediately.
 *   - Privileged direct-user creation requires approval.
 *   - Trust is never inferred from prompt wording.
 */
import type { JobSource, JobStatus } from "../domain/job.js";

// ─── Initial status by source ──────────────────────────

export interface InitialStatusParams {
  source: JobSource;
  /** Whether the user explicitly requested approval review. */
  requestApproval: boolean;
  /** Whether the creation is from a privileged context (e.g. admin/supervisor). */
  privileged: boolean;
}

/**
 * Resolve the initial status for a newly created job based on its source and
 * creation context. This is the single policy point for source-aware initial state.
 *
 * Rules:
 *   - tool        → always `pending_approval`
 *   - project_import → always `pending_approval`
 *   - direct_user → `active` unless `requestApproval` or `privileged` is true, then `pending_approval`
 */
export function resolveInitialStatus(params: InitialStatusParams): JobStatus {
  switch (params.source) {
    case "tool":
      return "pending_approval";
    case "project_import":
      return "pending_approval";
    case "direct_user":
      if (params.requestApproval || params.privileged) {
        return "pending_approval";
      }
      return "active";
    default:
      // Conservative default: require approval for unknown sources
      return "pending_approval";
  }
}

/**
 * Whether a job at the given status is eligible for scheduled dispatch.
 */
export function isDispatchable(status: JobStatus): boolean {
  return status === "active";
}

/**
 * Whether a job requires approval before it can be dispatched.
 */
export function requiresApproval(status: JobStatus): boolean {
  return status === "pending_approval";
}

/**
 * Whether user-level operations (pause, resume, archive, delete) are allowed
 * for the given status.
 */
export function isUserOperationAllowed(status: JobStatus): boolean {
  switch (status) {
    case "pending_approval":
    case "active":
    case "paused":
      return true;
    default:
      return false;
  }
}

/**
 * Check whether a status transition is valid.
 */
const VALID_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  draft: ["pending_approval", "active", "archived", "invalid"],
  pending_approval: ["active", "paused", "disabled", "archived", "invalid"],
  active: ["paused", "disabled", "archived"],
  paused: ["active", "archived"],
  disabled: ["archived"],
  archived: [],
  invalid: ["archived"],
};

export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

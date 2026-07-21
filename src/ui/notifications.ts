import type { ImportReconciliationResult } from "../domain/import.js";
import type { Job } from "../domain/job.js";
import { abbreviateId } from "./job-detail-view.js";

export type NotificationSeverity = "info" | "warning" | "error";

export function actionNotification(action: string, data?: unknown): string {
  try {
    return buildActionNotification(action, data);
  } catch {
    return `Chronos ${action} completed`;
  }
}

function buildActionNotification(action: string, data?: unknown): string {
  const job = asJob(data);
  const name = job ? `“${job.definition.name}”` : entityId(data);
  switch (action) {
    case "list": {
      const count = asJobList(data)?.length;
      return count === undefined ? "Loaded Chronos jobs" : `Loaded ${count} Chronos jobs`;
    }
    case "get":
      return `Opened ${name}`;
    case "create":
      return `Created ${name}`;
    case "update":
      return `Updated ${name}`;
    case "archive":
      return `Archived ${name}`;
    case "delete":
      return `Deleted ${name}`;
    case "pause":
      return `Paused ${name}`;
    case "resume":
      return `Resumed ${name}`;
    case "run_now":
      return `Queued manual run for ${name}`;
    case "cancel_run":
      return "Run cancellation requested";
    case "approve":
      return `Approved ${name}`;
    case "revoke_approval":
      return `Revoked approval for ${name}`;
    case "import": {
      const result = asImportResult(data);
      if (!result) return "Imported Chronos definitions";
      const changes = result.updated + result.disabled;
      const imported = result.created + result.unchanged + result.updated;
      return changes > 0
        ? `Imported ${imported} jobs · ${changes} changes require review`
        : `Imported ${imported} jobs`;
    }
    case "health":
      return "Chronos health refreshed";
    default:
      return `Chronos ${action} completed`;
  }
}

export function errorNotification(message: string): {
  message: string;
  severity: NotificationSeverity;
} {
  return { message, severity: "error" };
}

function asJob(value: unknown): Job | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.definition))
    return undefined;
  if (typeof value.definition.name !== "string") return undefined;
  return value as unknown as Job;
}

function asJobList(value: unknown): Job[] | undefined {
  if (!isRecord(value) || !Array.isArray(value.jobs)) return undefined;
  return value.jobs.filter((item): item is Job => asJob(item) !== undefined);
}

function asImportResult(value: unknown): ImportReconciliationResult | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !["created", "unchanged", "updated", "disabled"].every((key) => typeof value[key] === "number")
  )
    return undefined;
  return value as unknown as ImportReconciliationResult;
}

function entityId(value: unknown): string {
  if (isRecord(value) && typeof value.id === "string") return `job ${abbreviateId(value.id)}`;
  if (isRecord(value) && typeof value.jobId === "string") return `job ${abbreviateId(value.jobId)}`;
  if (isRecord(value) && typeof value.runId === "string") return `run ${abbreviateId(value.runId)}`;
  return "the requested item";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

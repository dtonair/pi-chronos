import type { AuditEvent } from "../domain/audit.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { appendAuditEvent } from "../storage/repositories/audit-repository.js";

/** Audit failures are returned to health by the caller, never allowed to alter truth. */
export function persistAudit(adapter: DatabaseAdapter, event: AuditEvent): boolean {
  try {
    return appendAuditEvent(adapter, event).ok;
  } catch {
    return false;
  }
}

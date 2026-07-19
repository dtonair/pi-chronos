/**
 * Audit event repository with append-only persistence and paginated retrieval.
 */

import type { AuditEvent, AuditEventType } from "../../domain/audit.js";
import type { Result } from "../../shared/result.js";
import { ok } from "../../shared/result.js";
import { type AuditRow, decodeAuditRow, encodeAuditRow } from "../codecs.js";
import type { DatabaseAdapter } from "../database.js";

// ─── Append event ─────────────────────────────

export function appendAuditEvent(adapter: DatabaseAdapter, event: AuditEvent): Result<void> {
  const row = encodeAuditRow(event);
  adapter.run(
    `INSERT INTO audit_events (id, event_name, actor, job_id, run_id, timestamp, old_fingerprint, new_fingerprint, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.event_name,
    row.actor,
    row.job_id,
    row.run_id,
    row.timestamp,
    row.old_fingerprint,
    row.new_fingerprint,
    row.details_json,
  );
  return ok(undefined);
}

// ─── Append multiple events in a batch ─────────

export function appendAuditEvents(adapter: DatabaseAdapter, events: AuditEvent[]): Result<void> {
  for (const event of events) {
    const result = appendAuditEvent(adapter, event);
    if (!result.ok) return result;
  }
  return ok(undefined);
}

// ─── Get by entity with pagination ──────────────

export interface AuditOptions {
  jobId?: string;
  runId?: string;
  eventType?: AuditEventType;
  cursor?: string;
  limit?: number;
}

export interface AuditResult {
  events: AuditEvent[];
  nextCursor?: string;
}

export function listAuditEvents(adapter: DatabaseAdapter, options: AuditOptions): AuditResult {
  const limit = options.limit ?? 50;
  const clauses: string[] = [];
  const params: string[] = [];

  if (options.jobId !== undefined) {
    clauses.push("job_id = ?");
    params.push(options.jobId);
  }
  if (options.runId !== undefined) {
    clauses.push("run_id = ?");
    params.push(options.runId);
  }
  if (options.eventType !== undefined) {
    clauses.push("event_name = ?");
    params.push(options.eventType);
  }
  if (options.cursor !== undefined) {
    clauses.push("id > ?");
    params.push(options.cursor);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = adapter.all<AuditRow>(
    `SELECT * FROM audit_events ${whereClause} ORDER BY timestamp DESC, id ASC LIMIT ?`,
    ...params,
    limit + 1,
  );

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const events = pageRows.map((row) => decodeAuditRow(row));
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.id : undefined;
  return { events, nextCursor };
}

/**
 * Scheduler instance repository with heartbeat and stale detection.
 */

import type { SchedulerInstance } from "../../domain/instance.js";
import type { UTCTimestamp } from "../../domain/job.js";
import type { Result } from "../../shared/result.js";
import { ok } from "../../shared/result.js";
import { decodeInstanceRow, encodeInstanceRow, type InstanceRow } from "../codecs.js";
import type { DatabaseAdapter } from "../database.js";

// ─── Register new instance ──────────────────────

export function registerInstance(
  adapter: DatabaseAdapter,
  instance: SchedulerInstance,
): Result<SchedulerInstance> {
  const row = encodeInstanceRow(instance);
  adapter.run(
    `INSERT INTO scheduler_instances (id, hostname, process_id, started_at, heartbeat_at, stopped_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    row.id,
    row.hostname,
    row.process_id,
    row.started_at,
    row.heartbeat_at,
    row.stopped_at,
  );
  return ok(instance);
}

// ─── Get instance by ID ──────────────────────────

export function getInstanceById(
  adapter: DatabaseAdapter,
  id: string,
): SchedulerInstance | undefined {
  const row = adapter.get<InstanceRow>("SELECT * FROM scheduler_instances WHERE id = ?", id);
  if (row === undefined) return undefined;
  return decodeInstanceRow(row);
}

// ─── Update heartbeat ────────────────────────────

export function updateHeartbeat(
  adapter: DatabaseAdapter,
  id: string,
  heartbeatAt: UTCTimestamp,
): Result<void> {
  adapter.run(
    "UPDATE scheduler_instances SET heartbeat_at = ? WHERE id = ?",
    new Date(heartbeatAt).toISOString(),
    id,
  );
  return ok(undefined);
}

// ─── Mark instance as stopped ─────────────────────

export function stopInstance(
  adapter: DatabaseAdapter,
  id: string,
  stoppedAt: UTCTimestamp,
): Result<void> {
  adapter.run(
    "UPDATE scheduler_instances SET stopped_at = ? WHERE id = ?",
    new Date(stoppedAt).toISOString(),
    id,
  );
  return ok(undefined);
}

// ─── Get stale instances (for recovery) ───────────

export function getStaleInstances(
  adapter: DatabaseAdapter,
  staleThreshold: UTCTimestamp,
): SchedulerInstance[] {
  const rows = adapter.all<InstanceRow>(
    `SELECT * FROM scheduler_instances
     WHERE stopped_at IS NULL
       AND heartbeat_at <= ?
     ORDER BY heartbeat_at ASC`,
    new Date(staleThreshold).toISOString(),
  );
  return rows.map((row) => decodeInstanceRow(row));
}

// ─── Check if an instance is still active ──────────

export function isInstanceActive(
  adapter: DatabaseAdapter,
  id: string,
  staleThreshold: UTCTimestamp,
): boolean {
  const row = adapter.get<InstanceRow>(
    `SELECT * FROM scheduler_instances
     WHERE id = ? AND stopped_at IS NULL AND heartbeat_at > ?`,
    id,
    new Date(staleThreshold).toISOString(),
  );
  return row !== undefined;
}

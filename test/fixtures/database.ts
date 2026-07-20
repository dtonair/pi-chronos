/**
 * Deterministic database fixtures for integration tests.
 *
 * Creates temporary on-disk databases with schema applied and
 * provides factory functions for test data.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JobApproval } from "../../src/domain/approval.js";
import type { Job, UTCTimestamp } from "../../src/domain/job.js";
import type { JobPermissions } from "../../src/domain/permission.js";
import type { Run } from "../../src/domain/run.js";
import { type DatabaseAdapter, openDatabase } from "../../src/storage/database.js";
import { createMigrations } from "../../src/storage/migrations.js";

// Load migration SQL once
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let MIGRATION_SQL: string | null = null;
try {
  const schemaPath = join(__dirname, "../../src/storage/schema/001_initial.sql");
  MIGRATION_SQL = readFileSync(schemaPath, "utf-8");
} catch {
  // Migration SQL unavailable
}

function getMigrations() {
  if (MIGRATION_SQL === null) {
    throw new Error("Failed to load migration SQL");
  }
  return createMigrations([MIGRATION_SQL]);
}

export interface TestDb {
  adapter: DatabaseAdapter;
  dir: string;
  close(): void;
}

/**
 * Create a temporary database with migrations applied.
 */
export function createTestDatabase(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "chronos-test-"));
  const dbPath = join(dir, "test.db");
  const migrations = getMigrations();

  const result = openDatabase({ path: dbPath, create: true }, migrations);
  if (!result.ok) {
    rmSync(dir, { recursive: true, force: true });
    throw result.error;
  }

  return {
    adapter: result.value,
    dir,
    close() {
      try {
        result.value.close();
      } catch {
        /* ok */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const DEFAULT_PERMISSIONS: JobPermissions = {
  tools: ["read", "write"],
  shell: { allowed: true, commands: ["echo hello"] },
  filesystem: { readPaths: ["/tmp"], writePaths: ["/tmp"] },
  network: { allowed: false, domains: [] },
  extensions: { allowedIds: [] },
  secrets: { allowedNames: [] },
};

export function createTestJob(overrides: Partial<Job> = {}): Job {
  const now = Date.now() as UTCTimestamp;
  const id = overrides.id ?? randomUUID();
  const defn: Partial<Job["definition"]> = overrides.definition ?? {};
  const name = defn.name ?? "test-job";

  return {
    id,
    revision: overrides.revision ?? 1,
    schemaVersion: 1,
    definition: {
      name,
      tags: defn.tags ?? [],
      prompt: defn.prompt ?? "Do something useful",
      schedule: defn.schedule ?? {
        kind: "interval",
        everyMs: 3600_000,
      },
      model: defn.model ?? "default",
      identity: defn.identity ?? {
        scope: "user",
        scopeKey: "test-user",
      },
      execution: defn.execution ?? {
        mode: "subagent",
        workingDirectory: "/tmp",
        timeoutMs: 600_000,
        maxOutputBytes: 262_144,
        overlapPolicy: "skip",
        missedRunPolicy: "skip",
        sandboxRequired: false,
        environment: { values: {}, secretNames: [] },
      },
      permissions: defn.permissions ?? DEFAULT_PERMISSIONS,
      source: defn.source ?? "tool",
      description: defn.description,
      importKey: defn.importKey,
    },
    status: overrides.status ?? "active",
    fingerprint: overrides.fingerprint ?? "a".repeat(64),
    approvedFingerprint: overrides.approvedFingerprint,
    createdAt: overrides.createdAt ?? now,
    createdBy: overrides.createdBy ?? "test",
    updatedAt: overrides.updatedAt ?? now,
    updatedBy: overrides.updatedBy ?? "test",
    nextRunAt:
      overrides.nextRunAt === null
        ? null
        : (overrides.nextRunAt ?? ((now + 60_000) as UTCTimestamp)),
    consecutiveFailures: overrides.consecutiveFailures ?? 0,
  };
}

export function createTestRun(overrides: Partial<Run> = {}): Run {
  const now = Date.now() as UTCTimestamp;
  const id = overrides.id ?? randomUUID();

  return {
    id,
    jobId: overrides.jobId ?? "job-00000001",
    occurrenceKey: overrides.occurrenceKey ?? `occ-${id}`,
    occurrenceAt: overrides.occurrenceAt ?? now,
    jobRevision: overrides.jobRevision ?? 1,
    trigger: overrides.trigger ?? "scheduled",
    attempt: overrides.attempt ?? 1,
    status: overrides.status ?? "queued",
    timing: {
      queuedAt: overrides.timing?.queuedAt ?? now,
      claimedAt: overrides.timing?.claimedAt,
      startedAt: overrides.timing?.startedAt,
      finishedAt: overrides.timing?.finishedAt,
    },
    events: overrides.events ?? [],
    ...overrides,
  };
}

export function createTestApproval(overrides: Partial<JobApproval> = {}): JobApproval {
  const now = Date.now() as UTCTimestamp;
  return {
    id: overrides.id ?? randomUUID(),
    jobId: overrides.jobId ?? "job-00000001",
    fingerprint: overrides.fingerprint ?? "a".repeat(64),
    approvedBy: overrides.approvedBy ?? "test-user",
    approvedAt: overrides.approvedAt ?? now,
    source: overrides.source ?? "tui",
    ...overrides,
  };
}

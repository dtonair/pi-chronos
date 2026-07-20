/**
 * Migration integration tests.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { DatabaseAdapter } from "../../../src/storage/database.js";
import { detectSQLite, openDatabase } from "../../../src/storage/database.js";
import { createMigrations } from "../../../src/storage/migrations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let MIGRATION_SQL = "";
let MIGRATION_002_SQL = "";
beforeAll(() => {
  const schemaPath = join(__dirname, "../../../src/storage/schema/001_initial.sql");
  MIGRATION_SQL = readFileSync(schemaPath, "utf-8");
  const schema002Path = join(__dirname, "../../../src/storage/schema/002_add_metadata_index.sql");
  MIGRATION_002_SQL = readFileSync(schema002Path, "utf-8");
});

function tempDbPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "chronos-mig-"));
  return { dir, path: join(dir, "test.db") };
}

describe("Migration Tests", () => {
  it("should return a stable error for an unusable database path", () => {
    const result = openDatabase(
      { path: "/dev/null/chronos.db", create: true },
      createMigrations([MIGRATION_SQL]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_ERROR");
  });

  it("should detect node:sqlite availability and report unsupported runtimes", () => {
    const result = detectSQLite();
    expect(result.ok).toBe(true);
    const unavailable = detectSQLite(() => undefined);
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) expect(unavailable.error.code).toBe("SQLITE_UNAVAILABLE");
  });

  it("should reject an unknown already-applied migration version", () => {
    const { dir, path } = tempDbPath();
    try {
      const first = openDatabase({ path, create: true }, createMigrations([MIGRATION_SQL]));
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      first.value.run(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)",
        99,
        "unknown",
        new Date().toISOString(),
      );
      first.value.close();
      const reopened = openDatabase({ path, create: true }, createMigrations([MIGRATION_SQL]));
      expect(reopened.ok).toBe(false);
      if (!reopened.ok) expect(reopened.error.code).toBe("MIGRATION_ERROR");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should create a new database and apply migrations", () => {
    const { dir, path } = tempDbPath();
    try {
      const migrations = createMigrations([MIGRATION_SQL]);
      const result = openDatabase({ path, create: true }, migrations);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const db: DatabaseAdapter = result.value;

      expect(db.permissionSemantics).toBe(
        process.platform === "win32" ? "unsupported" : "enforced",
      );
      expect(db.currentVersion).toBe(1);

      const tables = db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      );
      const tableNames = tables.map((t: { name: string }) => t.name);
      expect(tableNames).toContain("jobs");
      expect(tableNames).toContain("job_runs");
      expect(tableNames).toContain("job_approvals");
      expect(tableNames).toContain("scheduler_instances");
      expect(tableNames).toContain("audit_events");
      expect(tableNames).toContain("schema_migrations");

      const pragma = db.get<{ journal_mode: string }>("PRAGMA journal_mode");
      expect(pragma?.journal_mode).toBe("wal");

      const fk = db.get<{ foreign_keys: number }>("PRAGMA foreign_keys");
      expect(fk?.foreign_keys).toBe(1);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should reopen an existing database idempotently", () => {
    const { dir, path } = tempDbPath();
    try {
      const migrations = createMigrations([MIGRATION_SQL]);
      const result1 = openDatabase({ path, create: true }, migrations);
      expect(result1.ok).toBe(true);
      if (!result1.ok) return;
      result1.value.close();

      const result2 = openDatabase({ path, create: true }, migrations);
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.value.currentVersion).toBe(1);
      result2.value.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should reject checksum mismatches on already-applied migrations", () => {
    const { dir, path } = tempDbPath();
    try {
      const migrations = createMigrations([MIGRATION_SQL]);
      const result1 = openDatabase({ path, create: true }, migrations);
      expect(result1.ok).toBe(true);
      if (!result1.ok) return;
      result1.value.close();

      const tamperedSql = `${MIGRATION_SQL}\n-- tampered`;
      const tampered = createMigrations([tamperedSql]);
      const result2 = openDatabase({ path, create: true }, tampered);
      expect(result2.ok).toBe(false);
      if (!result2.ok) {
        expect(result2.error.code).toBe("MIGRATION_ERROR");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should rollback a failed migration transactionally", () => {
    const { dir, path } = tempDbPath();
    try {
      const badSql = "CREATE TABLE jobs (id TEXT); INVALID SQL SYNTAX";
      const migrations = createMigrations([badSql]);
      const result = openDatabase({ path, create: true }, migrations);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MIGRATION_ERROR");
      }

      // Verify we can open it with valid migrations after failure
      const validMigrations = createMigrations([MIGRATION_SQL]);
      const reopenResult = openDatabase({ path, create: true }, validMigrations);
      if (reopenResult.ok) {
        expect(reopenResult.value.currentVersion).toBe(1);
        reopenResult.value.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should apply multiple migrations in order", () => {
    const { dir, path } = tempDbPath();
    try {
      const migrations = createMigrations([MIGRATION_SQL, MIGRATION_002_SQL]);
      const result = openDatabase({ path, create: true }, migrations);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const db = result.value;

      // Both migrations applied
      expect(db.currentVersion).toBe(2);

      // Verify first migration tables exist
      const tables = db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      );
      const tableNames = tables.map((t: { name: string }) => t.name);
      expect(tableNames).toContain("jobs");

      // Verify second migration index exists
      const indexes = db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_jobs_metadata'",
      );
      expect(indexes.length).toBe(1);

      // Verify migration records
      const records = db.all<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      expect(records.length).toBe(2);
      expect(records.map((r: { version: number }) => r.version)).toEqual([1, 2]);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should create user-private database file on POSIX", () => {
    const { dir, path } = tempDbPath();
    try {
      const migrations = createMigrations([MIGRATION_SQL]);
      const result = openDatabase({ path, create: true }, migrations);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Close so file stats are stable
      result.value.close();

      // Check file permissions: should not be readable by group/other
      const fileStat = statSync(path);
      const fileMode = fileStat.mode & 0o777;
      // On POSIX, file should be at most rw------- (600)
      // Some systems may have more permissive umask, so check that
      // group and other bits are not set.
      const groupBits = fileMode & 0o070;
      const otherBits = fileMode & 0o007;
      expect(groupBits).toBe(0);
      expect(otherBits).toBe(0);

      // Directory should have appropriate permissions too
      const dirStat = statSync(dir);
      const dirMode = dirStat.mode & 0o777;
      const dirOtherBits = dirMode & 0o007;
      expect(dirOtherBits).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("should create schema_migrations table during first open", () => {
    const { dir, path } = tempDbPath();
    try {
      const migrations = createMigrations([MIGRATION_SQL]);
      const result = openDatabase({ path, create: true }, migrations);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const db = result.value;
      const row = db.get<{ version: number }>(
        "SELECT version FROM schema_migrations WHERE version = ?",
        1,
      );
      expect(row).toBeDefined();
      expect(row?.version).toBe(1);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

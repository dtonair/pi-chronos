/**
 * Checksummed migration loading and transactional application.
 *
 * Migration failure leaves the previous schema usable for diagnostics
 * but blocks dispatch until resolved.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export interface MigrationRecord {
  /** Integer version number. */
  version: number;
  /** SQL content. */
  sql: string;
  /** Checksum of the SQL content. */
  checksum: string;
}

/**
 * Compute a checksum for migration SQL content.
 */
function computeChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf-8").digest("hex");
}

/**
 * Create a list of migration records from raw SQL strings.
 */
export function createMigrations(sqls: string[]): MigrationRecord[] {
  return sqls.map((sql, index) => ({
    version: index + 1,
    sql,
    checksum: computeChecksum(sql),
  }));
}

interface AppliedMigration {
  version: number;
  checksum: string;
  applied_at: string;
}

/**
 * Load and apply pending migrations in order, each in its own transaction.
 * Verifies checksums on already-applied migrations.
 */
export function loadMigrations(
  db: DatabaseSync,
  migrations: readonly MigrationRecord[],
): Result<number> {
  // Read applied migrations
  let applied: AppliedMigration[];
  try {
    const stmt = db.prepare(
      "SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version ASC",
    );
    applied = stmt.all() as unknown as AppliedMigration[];
  } catch (cause) {
    return err(
      ChronosError.wrap(
        ChronosErrorCode.MIGRATION_ERROR,
        "Failed to read schema_migrations table",
        cause,
      ),
    );
  }

  // Verify checksums on already-applied migrations
  const appliedVersions = new Set(applied.map((r) => r.version));
  for (const record of applied) {
    const migration = migrations.find((m) => m.version === record.version);
    if (migration === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.MIGRATION_ERROR,
          message: `Unknown migration version ${record.version} already applied`,
          meta: { version: record.version },
        }),
      );
    }
    if (migration.checksum !== record.checksum) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.MIGRATION_ERROR,
          message:
            `Checksum mismatch for migration version ${record.version}: ` +
            `expected ${migration.checksum}, got ${record.checksum}`,
          meta: {
            version: record.version,
            expected: migration.checksum,
            actual: record.checksum,
          },
        }),
      );
    }
  }

  // Find and apply pending migrations
  const pending = migrations
    .filter((m) => !appliedVersions.has(m.version))
    .sort((a, b) => a.version - b.version);

  const now = new Date().toISOString();
  for (const migration of pending) {
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(migration.sql);
      // Record the migration
      const recordStmt = db.prepare(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)",
      );
      recordStmt.run(migration.version, migration.checksum, now);
      db.exec("COMMIT");
      appliedVersions.add(migration.version);
    } catch (cause) {
      // Attempt rollback
      try {
        db.exec("ROLLBACK");
      } catch {
        /* best effort */
      }

      // Compute the previous version for diagnostics
      const previousVersion = Math.max(0, ...appliedVersions);

      return err(
        new ChronosError({
          code: ChronosErrorCode.MIGRATION_ERROR,
          message:
            `Failed to apply migration version ${migration.version}. ` +
            `Schema is at version ${previousVersion} and remains usable for diagnostics.`,
          meta: {
            failedVersion: migration.version,
            currentVersion: previousVersion,
            checksum: migration.checksum,
          },
          cause,
        }),
      );
    }
  }

  // Compute current version
  // Re-read to get the latest
  let maxVersion = 0;
  try {
    const stmt = db.prepare("SELECT MAX(version) as version FROM schema_migrations");
    const row = stmt.get() as { version: number | null } | undefined;
    maxVersion = row?.version ?? 0;
  } catch {
    // Fallback: use highest from applied set or pending
    for (const m of applied) {
      if (m.version > maxVersion) maxVersion = m.version;
    }
  }

  return ok(maxVersion);
}

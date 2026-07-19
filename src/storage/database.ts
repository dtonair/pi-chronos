/**
 * node:sqlite adapter for Chronos.
 *
 * Feature-detects required APIs, enables WAL + foreign keys + busy timeout,
 * creates the containing directory with user-private modes on POSIX,
 * and exposes explicit transaction boundaries.
 */
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { loadMigrations, type MigrationRecord } from "./migrations.js";

export interface DatabaseAdapter {
  readonly db: DatabaseSync;
  readonly path: string;

  /** Run a query that returns rows. */
  all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[];

  /** Run a query and return the first row or undefined. */
  get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined;

  /** Execute a statement that modifies rows. */
  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number };

  /** Execute raw SQL (for DDL, pragmas). */
  exec(sql: string): void;

  /** Begin a deferred transaction. */
  begin(): void;

  /** Begin an immediate transaction. */
  beginImmediate(): void;

  /** Commit the current transaction. */
  commit(): void;

  /** Rollback the current transaction. */
  rollback(): void;

  /** Close the database. */
  close(): void;

  /** Migration state. */
  readonly currentVersion: number;
  readonly migrations: readonly MigrationRecord[];
}

/**
 * Feature-detect node:sqlite synchronous API.
 * Throws ChronosError(SQLITE_UNAVAILABLE) if not available.
 */
export function detectSQLite(): Result<void> {
  try {
    void DatabaseSync;
    return ok(undefined);
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.SQLITE_UNAVAILABLE,
        message: "node:sqlite (DatabaseSync) is not available in this Node.js runtime",
      }),
    );
  }
}

export interface OpenDatabaseOptions {
  path: string;
  /** If true, create the database file if it does not exist. */
  create?: boolean;
  /** If true, open in read-only mode. */
  readOnly?: boolean;
}

/**
 * Open a Chronos database, run migrations, and return a verified adapter.
 */
export function openDatabase(
  options: OpenDatabaseOptions,
  migrations: readonly MigrationRecord[],
): Result<DatabaseAdapter> {
  const detectResult = detectSQLite();
  if (!detectResult.ok) return detectResult;

  const { path, readOnly = false } = options;

  // Ensure containing directory exists with user-private modes on POSIX
  const parentDir = dirname(path);
  try {
    mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  } catch (_cause) {
    // Non-fatal: we'll still try to open the database.
    // The SQLite open will fail if the directory truly cannot be used.
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { open: !readOnly, readOnly });
    // Enforce user-private file permissions where supported (POSIX only)
    try {
      chmodSync(path, 0o600);
    } catch {
      // Non-fatal on platforms that don't support chmod
    }
  } catch (cause) {
    return err(
      ChronosError.wrap(ChronosErrorCode.DATABASE_ERROR, `Failed to open database: ${path}`, cause),
    );
  }

  try {
    // Enable core pragmas
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");

    // Create migrations table if needed
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version       INTEGER NOT NULL PRIMARY KEY,
        checksum      TEXT NOT NULL,
        applied_at    TEXT NOT NULL
      )
    `);

    // Load and apply migrations
    const migrationResult = loadMigrations(db, migrations);
    if (!migrationResult.ok) {
      db.close();
      return err(migrationResult.error);
    }

    const currentVersion = migrationResult.value;

    const adapter: DatabaseAdapter = {
      db,
      path,
      currentVersion,
      migrations,

      all<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[] {
        const stmt = db.prepare(sql);
        return stmt.all(...params) as T[];
      },

      get<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T | undefined {
        const stmt = db.prepare(sql);
        return stmt.get(...params) as T | undefined;
      },

      run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
        const stmt = db.prepare(sql);
        const result = stmt.run(...params) as { changes: number; lastInsertRowid: number | bigint };
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
      },

      exec(sql: string): void {
        db.exec(sql);
      },

      begin(): void {
        db.exec("BEGIN DEFERRED");
      },

      beginImmediate(): void {
        db.exec("BEGIN IMMEDIATE");
      },

      commit(): void {
        db.exec("COMMIT");
      },

      rollback(): void {
        db.exec("ROLLBACK");
      },

      close(): void {
        db.close();
      },
    };

    return ok(adapter);
  } catch (cause) {
    try {
      db.close();
    } catch {
      /* best effort */
    }
    return err(
      ChronosError.wrap(ChronosErrorCode.MIGRATION_ERROR, "Failed to initialize database", cause),
    );
  }
}

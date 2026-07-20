/**
 * node:sqlite adapter for Chronos.
 *
 * Feature-detects required APIs, enables WAL + foreign keys + busy timeout,
 * creates the containing directory with user-private modes on POSIX,
 * and exposes explicit transaction boundaries.
 */
import { chmodSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { loadMigrations, type MigrationRecord } from "./migrations.js";

export type PermissionSemantics = "enforced" | "unsupported";

type DatabaseSyncConstructor = new (
  path: string,
  options?: { open?: boolean; readOnly?: boolean },
) => DatabaseSync;

const require = createRequire(import.meta.url);

function loadDatabaseSync(): DatabaseSyncConstructor | undefined {
  try {
    const sqlite = require("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor };
    return sqlite.DatabaseSync;
  } catch {
    return undefined;
  }
}

export interface DatabaseAdapter {
  readonly db: DatabaseSync;
  readonly path: string;
  /** Whether user-private filesystem modes were enforced or could not be verified. */
  readonly permissionSemantics: PermissionSemantics;

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

  /** Current transaction nesting depth for scoped nested transactions. */
  readonly transactionDepth?: number;

  /** Migration state. */
  readonly currentVersion: number;
  readonly migrations: readonly MigrationRecord[];
}

/**
 * Feature-detect node:sqlite synchronous API.
 * Returns ChronosError(SQLITE_UNAVAILABLE) if not available.
 */
export function detectSQLite(loader: () => unknown = loadDatabaseSync): Result<void> {
  if (loader()) return ok(undefined);
  return err(
    new ChronosError({
      code: ChronosErrorCode.SQLITE_UNAVAILABLE,
      message: "node:sqlite (DatabaseSync) is not available in this Node.js runtime",
    }),
  );
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
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.SQLITE_UNAVAILABLE,
        message: "node:sqlite (DatabaseSync) is not available in this Node.js runtime",
      }),
    );
  }

  const { path, readOnly = false } = options;

  // Ensure containing directory exists with user-private modes on POSIX.
  // Keep the result explicit: callers must not claim private storage when the
  // host cannot enforce or verify these semantics.
  const parentDir = dirname(path);
  let permissionSemantics: PermissionSemantics =
    process.platform === "win32" ? "unsupported" : "enforced";
  try {
    mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    if (permissionSemantics === "enforced") {
      chmodSync(parentDir, 0o700);
      if ((statSync(parentDir).mode & 0o077) !== 0) permissionSemantics = "unsupported";
    }
  } catch (_cause) {
    permissionSemantics = "unsupported";
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { open: !readOnly, readOnly });
  } catch (cause) {
    return err(
      ChronosError.wrap(ChronosErrorCode.DATABASE_ERROR, `Failed to open database: ${path}`, cause),
    );
  }
  if (permissionSemantics === "enforced") {
    try {
      chmodSync(path, 0o600);
      if ((statSync(path).mode & 0o077) !== 0) permissionSemantics = "unsupported";
    } catch {
      permissionSemantics = "unsupported";
    }
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
    let transactionDepth = 0;

    const adapter: DatabaseAdapter = {
      db,
      path,
      permissionSemantics,
      currentVersion,
      migrations,
      get transactionDepth() {
        return transactionDepth;
      },

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
        transactionDepth += 1;
      },

      beginImmediate(): void {
        db.exec("BEGIN IMMEDIATE");
        transactionDepth += 1;
      },

      commit(): void {
        db.exec("COMMIT");
        transactionDepth = Math.max(0, transactionDepth - 1);
      },

      rollback(): void {
        db.exec("ROLLBACK");
        transactionDepth = 0;
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

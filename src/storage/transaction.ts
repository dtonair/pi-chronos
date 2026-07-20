/**
 * Transaction helper for Chronos repository operations.
 *
 * Provides typed, scoped transaction boundaries over the DatabaseAdapter.
 * Repository operations can safely compose inside a larger transaction by
 * using SQLite savepoints when the adapter exposes transaction depth.
 */

import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err } from "../shared/result.js";
import type { DatabaseAdapter } from "./database.js";

let savepointSequence = 0;

type Scope = { savepoint?: string };

function beginScope(adapter: DatabaseAdapter, immediate: boolean): Scope {
  if ((adapter.transactionDepth ?? 0) > 0) {
    const savepoint = `chronos_sp_${savepointSequence++}`;
    adapter.exec(`SAVEPOINT ${savepoint}`);
    return { savepoint };
  }
  if (immediate) adapter.beginImmediate();
  else adapter.begin();
  return {};
}

function commitScope(adapter: DatabaseAdapter, scope: Scope): void {
  if (scope.savepoint === undefined) adapter.commit();
  else adapter.exec(`RELEASE SAVEPOINT ${scope.savepoint}`);
}

function rollbackScope(adapter: DatabaseAdapter, scope: Scope): void {
  if (scope.savepoint === undefined) {
    adapter.rollback();
    return;
  }
  try {
    adapter.exec(`ROLLBACK TO SAVEPOINT ${scope.savepoint}`);
  } finally {
    adapter.exec(`RELEASE SAVEPOINT ${scope.savepoint}`);
  }
}

function runInScope<T>(
  adapter: DatabaseAdapter,
  immediate: boolean,
  fn: () => Result<T>,
): Result<T> {
  let scope: Scope;
  try {
    scope = beginScope(adapter, immediate);
  } catch (cause) {
    return err(transactionError(cause));
  }
  try {
    const result = fn();
    if (result.ok) commitScope(adapter, scope);
    else rollbackScope(adapter, scope);
    return result;
  } catch (cause) {
    try {
      rollbackScope(adapter, scope);
    } catch {
      /* best effort */
    }
    return err(
      new ChronosError({
        code: ChronosErrorCode.INTERNAL_ERROR,
        message: "Transaction failed",
        cause,
      }),
    );
  }
}

/** Execute a callback within a deferred transaction. */
export function inTransaction<T>(adapter: DatabaseAdapter, fn: () => Result<T>): Result<T> {
  return runInScope(adapter, false, fn);
}

/** Execute a callback within an immediate transaction. */
export function inImmediateTransaction<T>(
  adapter: DatabaseAdapter,
  fn: () => Result<T>,
): Result<T> {
  return runInScope(adapter, true, fn);
}

function transactionError(cause: unknown): ChronosError {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new ChronosError({
    code: /locked|busy/i.test(message)
      ? ChronosErrorCode.DB_LOCKED
      : ChronosErrorCode.DATABASE_ERROR,
    message: "Unable to begin database transaction",
    cause,
  });
}

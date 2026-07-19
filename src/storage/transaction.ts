/**
 * Transaction helper for Chronos repository operations.
 *
 * Provides typed, scoped transaction boundaries over the DatabaseAdapter.
 */

import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err } from "../shared/result.js";
import type { DatabaseAdapter } from "./database.js";

/**
 * Execute a callback within a deferred transaction.
 * Rolls back on error, commits on success.
 */
export function inTransaction<T>(adapter: DatabaseAdapter, fn: () => Result<T>): Result<T> {
  adapter.begin();
  try {
    const result = fn();
    if (result.ok) {
      adapter.commit();
    } else {
      adapter.rollback();
    }
    return result;
  } catch (cause) {
    try {
      adapter.rollback();
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

/**
 * Execute a callback within an immediate transaction.
 * Use for operations that write and need to prevent concurrent modifications.
 */
export function inImmediateTransaction<T>(
  adapter: DatabaseAdapter,
  fn: () => Result<T>,
): Result<T> {
  adapter.beginImmediate();
  try {
    const result = fn();
    if (result.ok) {
      adapter.commit();
    } else {
      adapter.rollback();
    }
    return result;
  } catch (cause) {
    try {
      adapter.rollback();
    } catch {
      /* best effort */
    }
    return err(
      new ChronosError({
        code: ChronosErrorCode.INTERNAL_ERROR,
        message: "Immediate transaction failed",
        cause,
      }),
    );
  }
}

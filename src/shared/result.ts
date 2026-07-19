import { ChronosError, type ChronosErrorCode } from "../domain/errors.js";

// ─── Result type ──────────────────

export type Result<T, E = ChronosError> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E = ChronosError> {
  readonly ok: false;
  readonly error: E;
}

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E = ChronosError>(error: E): Err<E> {
  return { ok: false, error };
}

/** Convenience: wrap a throwing function into a Result. */
export function tryCatch<T>(fn: () => T, code: ChronosErrorCode, message: string): Result<T> {
  try {
    return ok(fn());
  } catch (e) {
    return err(ChronosError.wrap(code, message, e));
  }
}

/** Convenience: wrap an async throwing function into a Result. */
export async function tryCatchAsync<T>(
  fn: () => Promise<T>,
  code: ChronosErrorCode,
  message: string,
): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(ChronosError.wrap(code, message, e));
  }
}

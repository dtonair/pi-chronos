import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "./result.js";
import { err, ok } from "./result.js";

/**
 * Type-safe validation helpers. Returns Result with structured ChronosError.
 */

export type Validator<T> = (value: unknown) => Result<T>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

export function isInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function validateString(
  value: unknown,
  field: string,
  minLength = 0,
  maxLength = Infinity,
): Result<string> {
  if (!isString(value)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: `${field} must be a string`,
        meta: { field, actual: typeof value },
      }),
    );
  }
  if (value.length < minLength) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: `${field} must be at least ${minLength} characters`,
        meta: { field, minLength, actual: value.length },
      }),
    );
  }
  if (value.length > maxLength) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALUE_TOO_LONG,
        message: `${field} must not exceed ${maxLength} characters`,
        meta: { field, maxLength, actual: value.length },
      }),
    );
  }
  return ok(value);
}

export function validateInteger(
  value: unknown,
  field: string,
  min?: number,
  max?: number,
): Result<number> {
  if (!isInteger(value)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: `${field} must be an integer`,
        meta: { field, actual: typeof value },
      }),
    );
  }
  if (min !== undefined && value < min) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALUE_OUT_OF_RANGE,
        message: `${field} must be >= ${min}`,
        meta: { field, min, actual: value },
      }),
    );
  }
  if (max !== undefined && value > max) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALUE_OUT_OF_RANGE,
        message: `${field} must be <= ${max}`,
        meta: { field, max, actual: value },
      }),
    );
  }
  return ok(value);
}

export function validateBoolean(value: unknown, field: string): Result<boolean> {
  if (!isBoolean(value)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: `${field} must be a boolean`,
        meta: { field, actual: typeof value },
      }),
    );
  }
  return ok(value);
}

export function validateStringArray(value: unknown, field: string): Result<readonly string[]> {
  if (!isArray(value)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: `${field} must be an array`,
        meta: { field, actual: typeof value },
      }),
    );
  }
  for (let i = 0; i < value.length; i++) {
    if (!isString(value[i])) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.VALIDATION_ERROR,
          message: `${field}[${i}] must be a string`,
          meta: { field, index: i, actual: typeof value[i] },
        }),
      );
    }
  }
  return ok(value as readonly string[]);
}

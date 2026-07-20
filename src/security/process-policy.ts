import { accessSync, constants, realpathSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type {
  ProcessCommandRule,
  ProcessPermissions,
  ProcessSlotType,
} from "../domain/permission.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export interface AuthorizedProcess {
  executable: string;
  args: string[];
  rule: ProcessCommandRule;
}

const UUID = /^(?:\{)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\})?$/i;
const INTEGER = /^(?:0|-?[1-9][0-9]{0,18})$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function validateSlotValue(type: ProcessSlotType, value: string): boolean {
  if (value.length === 0 || value.length > 128 || /[\s\0]/.test(value)) return false;
  switch (type) {
    case "uuid":
      return UUID.test(value);
    case "integer":
      return INTEGER.test(value);
    case "slug":
      return SLUG.test(value);
  }
}

export function resolveExecutable(
  presented: string,
  pathValue = process.env.PATH ?? "",
): Result<string> {
  if (
    presented.length === 0 ||
    presented.length > 4_096 ||
    presented.includes("\0") ||
    /[\s]/.test(presented)
  ) {
    return processError("Executable is invalid");
  }
  const candidates =
    isAbsolute(presented) || presented.includes("/")
      ? [presented]
      : pathValue
          .split(delimiter)
          .filter(Boolean)
          .map((directory) => join(directory, presented));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return ok(realpathSync(candidate));
    } catch {
      // Try the next controlled PATH entry.
    }
  }
  return processError("Executable could not be resolved");
}

export function authorizeStructuredProcess(
  input: { executable: unknown; args: unknown },
  permissions: ProcessPermissions | undefined,
  pathValue = process.env.PATH ?? "",
): Result<AuthorizedProcess> {
  if (permissions === undefined || !permissions.allowed)
    return processError("Process execution is not allowed");
  if (typeof input.executable !== "string" || !Array.isArray(input.args))
    return processError("chronos_exec requires executable and argv");
  if (input.args.length > 32 || !input.args.every((arg): arg is string => typeof arg === "string"))
    return processError("Process argv is invalid");
  const resolved = resolveExecutable(input.executable, pathValue);
  if (!resolved.ok) return resolved;
  const rules = permissions.commands.filter(
    (candidate) => candidate.executable === input.executable,
  );
  if (rules.length === 0) return processError("Executable is not approved");
  for (const rule of rules) {
    const approved = resolveExecutable(rule.executable, pathValue);
    if (!approved.ok || approved.value !== resolved.value) continue;
    if (rule.args.length !== input.args.length) continue;
    let matches = true;
    for (let index = 0; index < rule.args.length; index++) {
      const expected = rule.args[index];
      const actual = input.args[index] as string;
      if (expected === undefined) {
        matches = false;
        break;
      }
      if (expected.kind === "literal" && expected.value !== actual) {
        matches = false;
        break;
      }
      if (expected.kind === "slot" && !validateSlotValue(expected.valueType, actual)) {
        matches = false;
        break;
      }
    }
    if (matches) return ok({ executable: resolved.value, args: [...input.args], rule });
  }
  return processError("Argument policy is not approved");
}

function processError(message: string): Result<never> {
  return err(new ChronosError({ code: ChronosErrorCode.PERMISSION_DENIED, message }));
}

import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobEnvironment } from "../domain/job.js";
import type { JobPermissions } from "../domain/permission.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENV_NAMES = new Set([
  "PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "BASH_ENV",
  "ENV",
]);

export function validateEnvironment(
  environment: JobEnvironment,
  permissions: JobPermissions,
): Result<Record<string, string>> {
  const allowedSecrets = new Set(permissions.secrets.allowedNames);
  for (const name of [...Object.keys(environment.values), ...environment.secretNames]) {
    if (!ENV_NAME.test(name)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.VALIDATION_ERROR,
          message: `Invalid environment name: ${name}`,
        }),
      );
    }
    if (RESERVED_ENV_NAMES.has(name)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: `Environment name is reserved: ${name}`,
          entity: name,
        }),
      );
    }
  }
  for (const name of environment.secretNames) {
    if (!allowedSecrets.has(name)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: `Secret is not allowlisted: ${name}`,
        }),
      );
    }
  }
  return ok({ ...environment.values });
}

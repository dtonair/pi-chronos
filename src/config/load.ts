import { readFileSync, statSync } from "node:fs";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { ChronosConfig } from "./defaults.js";
import { createConfig } from "./schema.js";

const MAX_CONFIG_BYTES = 1_048_576;

/** Load the trusted user-global Chronos config. A missing file uses defaults. */
export function loadGlobalConfig(path: string): ChronosConfig {
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(path);
  } catch (cause) {
    if (isMissing(cause)) return createConfig();
    throw configError(`Cannot inspect Chronos configuration: ${path}`, cause);
  }
  if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
    throw configError(`Chronos configuration must be a regular file under 1 MiB: ${path}`);
  }
  if (process.platform !== "win32") {
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
      throw configError(`Chronos configuration is not owned by the current user: ${path}`);
    }
    if ((info.mode & 0o022) !== 0) {
      throw configError(`Chronos configuration is writable by another user or group: ${path}`);
    }
  }
  try {
    return createConfig(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch (cause) {
    if (cause instanceof ChronosError) throw cause;
    throw configError(`Invalid Chronos configuration JSON: ${path}`, cause);
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function configError(message: string, cause?: unknown): ChronosError {
  return new ChronosError({ code: ChronosErrorCode.VALIDATION_ERROR, message, cause });
}

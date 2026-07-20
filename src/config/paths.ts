/**
 * Chronos data directory resolution.
 *
 * Resolves the default Chronos data path through Pi's agent-directory API
 * at the extension boundary and enforces user-private creation modes where supported.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Directory name within the agent data root. */
export const CHRONOS_DIR_NAME = "chronos";

/** Default database and trusted global configuration filenames. */
export const CHRONOS_DB_FILENAME = "chronos.db";
export const CHRONOS_CONFIG_FILENAME = "config.json";

/** Resolve the default Chronos data directory from a Pi agent data root. */
export function chronosDataDir(agentDataRoot: string): string {
  return join(agentDataRoot, CHRONOS_DIR_NAME);
}

/** Resolve the default database and configuration paths within a Chronos data directory. */
export function chronosDbPath(dataDir: string): string {
  return join(dataDir, CHRONOS_DB_FILENAME);
}

export function chronosConfigPath(dataDir: string): string {
  return join(dataDir, CHRONOS_CONFIG_FILENAME);
}

/** Fallback path when Pi agent data root is unavailable. */
export function fallbackChronosDir(): string {
  return join(homedir(), ".pi", CHRONOS_DIR_NAME);
}

/** Fallback database path. */
export function fallbackChronosDbPath(): string {
  return join(fallbackChronosDir(), CHRONOS_DB_FILENAME);
}

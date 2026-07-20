import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { UTCTimestamp } from "../domain/job.js";
import type { LogEntry, Logger, LogLevel } from "../shared/ports.js";

const rank: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createJsonlLogger(
  path: string,
  clock: { now(): UTCTimestamp },
  minimum: LogLevel = "info",
): Logger {
  let lastError: { message: string; timestamp: UTCTimestamp } | undefined;
  const write = (level: LogLevel, message: string, data?: Record<string, unknown>): void => {
    if (rank[level] < rank[minimum]) return;
    const entry: LogEntry = { level, message, timestamp: clock.now(), data };
    void mkdir(dirname(path), { recursive: true, mode: 0o700 })
      .then(() => appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 }))
      .catch((error: unknown) => {
        lastError = {
          message: error instanceof Error ? error.message : String(error),
          timestamp: clock.now(),
        };
      });
  };
  return {
    level: minimum,
    debug: (m, d) => write("debug", m, d),
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
    get lastError() {
      return lastError;
    },
  };
}

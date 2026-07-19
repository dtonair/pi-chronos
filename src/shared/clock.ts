import type { UTCTimestamp } from "../domain/job.js";

/**
 * Production clock implementation using Date.now() and Node timers.
 */
export function createSystemClock(): import("./ports.js").Clock {
  function now(): UTCTimestamp {
    return Date.now() as UTCTimestamp;
  }

  const maxTimeoutMs = 2_147_483_647; // Node maximum

  return {
    now,
    maxTimeoutMs,
    setTimeout(fn: () => void, ms: number) {
      let handle: ReturnType<typeof setTimeout> | undefined = globalThis.setTimeout(fn, ms);
      return {
        clear() {
          if (handle !== undefined) {
            globalThis.clearTimeout(handle);
            handle = undefined;
          }
        },
        refresh(ms: number) {
          if (handle !== undefined) {
            globalThis.clearTimeout(handle);
          }
          handle = globalThis.setTimeout(fn, ms);
        },
      };
    },
  };
}

import type { UTCTimestamp } from "../domain/job.js";

// ─── Timer delay calculation ─────────────────────────────────

/**
 * Calculate the bounded sleep delay in milliseconds before the next
 * occurrence. Returns the delay clamped below Node's timer ceiling
 * (signed 32-bit max) and the Chronos max timeout.
 *
 * Both clocks (system and fake) help: the system clock determines the
 * Node setTimeout ceiling, while the Chronos clamp is below that.
 *
 * For occurrences beyond the max timeout, we sleep for maxTimeoutMs
 * and then recalculate on wake.
 */
export function calculateTimerDelay(
  nextRunAtMs: UTCTimestamp,
  clockNow: UTCTimestamp,
  maxTimeoutMs: number,
): number {
  const rawDelay = nextRunAtMs - clockNow;

  if (rawDelay <= 0) {
    return 0; // fire immediately
  }

  // Clamp to maxTimeoutMs (below Node's native ~2.147B ms ceiling)
  return Math.min(rawDelay, maxTimeoutMs);
}

/**
 * Check whether the timer delay is clamped (i.e., the actual delay is
 * longer than what we're setting). This tells the coordinator to
 * recalculate on wake rather than dispatch.
 */
export function isDelayClamped(
  nextRunAtMs: UTCTimestamp,
  clockNow: UTCTimestamp,
  maxTimeoutMs: number,
): boolean {
  return nextRunAtMs - clockNow > maxTimeoutMs;
}

/**
 * The default callback for post-wake recalculation. When the timer
 * fires after a clamped delay, the coordinator recalculates which
 * jobs are due and arms a new timer.
 *
 * This is a stateless predicate used by the timer coordinator.
 */
export function shouldRecalculate(
  nextRunAtMs: UTCTimestamp,
  clockNow: UTCTimestamp,
  maxTimeoutMs: number,
): boolean {
  return isDelayClamped(nextRunAtMs, clockNow, maxTimeoutMs);
}

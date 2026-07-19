import type { UTCTimestamp } from "../../src/domain/job.js";
import type { Clock, ClockTimer } from "../../src/shared/ports.js";

// ─── Fake clock for deterministic schedule tests ──────────────
//
// Time is controlled by the test; timers fire synchronously when
// advance() is called, so no real-time sleeps are needed.

export interface FakeClock extends Clock {
  /** Set the current time. Triggers any timers that would have fired. */
  setTime(ms: number): void;
  /** Advance time by ms. Triggers any timers that would have fired. */
  advance(ms: number): void;
  /** Return current time. */
  now(): UTCTimestamp;
  /** List of pending timer handles. */
  readonly pending: number;
}

export function createFakeClock(initialMs = 0, maxTimeoutMs = 2_147_000_000): FakeClock {
  let currentMs = initialMs;
  let nextTimerId = 0;
  const timers: Map<number, { dueMs: number; fn: () => void; cleared: boolean }> = new Map();

  function fireTimers(): void {
    // fire all timers whose dueMs <= currentMs
    let fired: number;
    do {
      fired = 0;
      for (const [id, timer] of timers) {
        if (!timer.cleared && timer.dueMs <= currentMs) {
          timer.cleared = true;
          timer.fn();
          timers.delete(id);
          fired++;
        }
      }
    } while (fired > 0);
  }

  const clock: FakeClock = {
    maxTimeoutMs,

    now(): UTCTimestamp {
      return currentMs as UTCTimestamp;
    },

    setTimeout(fn: () => void, ms: number): ClockTimer {
      const id = nextTimerId++;
      const clamped = Math.min(ms, maxTimeoutMs);
      const dueMs = currentMs + clamped;
      timers.set(id, { dueMs, fn, cleared: false });

      return {
        clear() {
          const timer = timers.get(id);
          if (timer) timer.cleared = true;
        },
        refresh(newMs: number) {
          const timer = timers.get(id);
          if (timer) {
            timer.dueMs = currentMs + Math.min(newMs, maxTimeoutMs);
            timer.cleared = false;
          } else {
            // Recreate if already cleared and deleted
            timers.set(id, {
              dueMs: currentMs + Math.min(newMs, maxTimeoutMs),
              fn,
              cleared: false,
            });
          }
        },
      };
    },

    setTime(ms: number): void {
      currentMs = ms;
      fireTimers();
    },

    advance(ms: number): void {
      if (ms < 0) return;
      currentMs += ms;
      fireTimers();
    },

    get pending(): number {
      let count = 0;
      for (const timer of timers.values()) {
        if (!timer.cleared) count++;
      }
      return count;
    },
  };

  return clock;
}

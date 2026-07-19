import type { JobSchedule, MissedRunPolicy, UTCTimestamp } from "../domain/job.js";
import type { CronCalculator } from "./cron.js";
import { missedIntervalOccurrences, resolveIntervalAnchor } from "./interval.js";

// ─── Missed-run calculation ───────────────────────────────────
//
// When a scheduler wakes and finds the last scheduled time is far in
// the past (e.g., scheduler was down for a while), it calculates
// which occurrences were missed and applies the job's missed-run policy.

export interface MissedRange {
  /** The first missed occurrence time (UTC ISO). */
  firstMissedAt: string;
  /** The last missed occurrence time (UTC ISO). */
  lastMissedAt: string;
  /** Number of occurrences missed. */
  missedCount: number;
}

/**
 * Calculate the range of missed occurrences between lastScheduledAt and now.
 *
 * Returns undefined if no occurrences were missed, or a MissedRange if
 * the policy is applicable.
 *
 * For "skip" policy: returns the range for audit/logging only (the run is skipped).
 * For "run_once" policy: returns the range, and a single catch-up run will be created.
 */
export function calculateMissedRange(
  schedule: JobSchedule,
  policy: MissedRunPolicy,
  lastScheduledAt: UTCTimestamp,
  nowMs: UTCTimestamp,
  cronCalc: CronCalculator,
): MissedRange | undefined {
  if (policy === "skip") {
    // For "skip", we still compute the range for logging but it won't create a run
    return calculateMissedRangeFor(schedule, lastScheduledAt, nowMs, cronCalc);
  }

  // "run_once": compute the range; a single catch-up run will be created
  return calculateMissedRangeFor(schedule, lastScheduledAt, nowMs, cronCalc);
}

function calculateMissedRangeFor(
  schedule: JobSchedule,
  fromMs: UTCTimestamp,
  toMs: UTCTimestamp,
  cronCalc: CronCalculator,
): MissedRange | undefined {
  switch (schedule.kind) {
    case "once":
      // Once schedules don't have multiple missed occurrences
      return undefined;

    case "interval": {
      const anchor = resolveIntervalAnchor(schedule, fromMs);
      const missed = missedIntervalOccurrences(anchor, schedule.everyMs, fromMs, toMs);
      if (!missed || missed.count === 0) return undefined;
      return {
        firstMissedAt: missed.first.occurrenceAt,
        lastMissedAt: missed.last.occurrenceAt,
        missedCount: missed.count,
      };
    }

    case "cron": {
      // Collect occurrences between fromMs and toMs.
      // We iteratively pull batches until we pass toMs or hit a safety cap.
      const rangeMs = toMs - fromMs;
      if (rangeMs <= 0) return undefined;

      // Pull in batches of 100 to avoid excessive calls
      const BATCH = 100;
      const MAX_BATCHES = 50; // safety: 5,000 max total
      const all: Array<{ utcMs: number; utcIso: string }> = [];

      let batchStart = fromMs;
      for (let b = 0; b < MAX_BATCHES; b++) {
        const occurrences = cronCalc.nextAfter(
          schedule.expression,
          schedule.timezone,
          batchStart,
          BATCH,
        );
        if (!occurrences.ok || occurrences.value.length === 0) break;

        for (const o of occurrences.value) {
          if (o.utcMs > toMs) break;
          all.push(o);
        }

        // If the last pulled occurrence is beyond toMs, we're done
        const last = occurrences.value[occurrences.value.length - 1];
        if (!last || last.utcMs > toMs) break;

        // Advance past the last pulled occurrence to get the next batch
        batchStart = last.utcMs;
      }

      if (all.length === 0) return undefined;

      const first = all[0];
      const lastAll = all[all.length - 1];
      if (!first || !lastAll) return undefined;

      return {
        firstMissedAt: first.utcIso,
        lastMissedAt: lastAll.utcIso,
        missedCount: Math.min(all.length, 1_000_000),
      };
    }
  }
}

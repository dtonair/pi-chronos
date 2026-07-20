import type { CronSchedule, IntervalSchedule, JobSchedule, OnceSchedule } from "../domain/job.js";

// ─── Occurrence keys ensure at-most-once delivery ──────────────
//
// Each schedule kind produces a deterministic key for a specific
// occurrence, so that inserting the same key in a duplicate run
// is rejected at the database uniqueness constraint.

/** Build a deterministic occurrence key from a UTC timestamp in ISO-8601 milliseconds. */
export function utcKey(scheduledUtc: string): string {
  return scheduledUtc;
}

export function onceOccurrenceKey(schedule: OnceSchedule, normalizedUtcIso?: string): string {
  // Use the normalized UTC instant when available. This prevents equivalent
  // offset-bearing and local representations from producing two runs.
  return `once:${normalizedUtcIso ?? schedule.runAt}`;
}

export function intervalOccurrenceKey(schedule: IntervalSchedule, occurrenceIndex: number): string {
  return `interval:${schedule.everyMs}:${occurrenceIndex}`;
}

export function cronOccurrenceKey(schedule: CronSchedule, utcIso: string): string {
  return `cron:${schedule.expression}:${schedule.timezone}:${utcIso}`;
}

/**
 * Build the occurrence key for the pre-computed next occurrence UTC timestamp.
 * The caller must have already resolved which occurrence is next.
 */
export function occurrenceKeyFor(schedule: JobSchedule, occurrenceUtcIso: string): string {
  switch (schedule.kind) {
    case "once":
      return onceOccurrenceKey(schedule, occurrenceUtcIso);
    case "interval": {
      // Interval occurrence index is derived from the anchor and the occurrence time.
      // We compute it as: (occurrenceMs - anchorMs) / everyMs
      const occurrenceMs = new Date(occurrenceUtcIso).getTime();
      if (schedule.anchorAt === undefined)
        return `interval:${schedule.everyMs}:${occurrenceUtcIso}`;
      const anchorMs = new Date(schedule.anchorAt).getTime();
      const index = Math.round((occurrenceMs - anchorMs) / schedule.everyMs);
      return intervalOccurrenceKey(schedule, index);
    }
    case "cron":
      return cronOccurrenceKey(schedule, occurrenceUtcIso);
  }
}

import type { JobSchedule, OnceSchedule, UTCTimestamp } from "../domain/job.js";
import type { Result } from "../shared/result.js";
import { ok } from "../shared/result.js";
import type { CronCalculator } from "./cron.js";
import { nextIntervalOccurrence, resolveIntervalAnchor } from "./interval.js";
import { normalizeOnce } from "./once.js";

// ─── Schedule preview ─────────────────────────────────────────
//
// Returns the normalized schedule plus the next three ordered future
// UTC occurrences without persistence calls.

export interface NormalizedSchedule {
  kind: "once" | "interval" | "cron";
  /** Normalized schedule with all defaults resolved. */
  schedule: JobSchedule;
  /** Human-readable description of the schedule. */
  description: string;
}

export interface SchedulePreview {
  /** The normalized schedule information. */
  schedule: NormalizedSchedule;
  /** The next three future occurrences as ISO-8601 UTC timestamps. */
  upcoming: string[];
}

/**
 * Preview a schedule: normalize it and return the next three occurrences.
 * This is a pure function that does not persist anything.
 */
export function previewSchedule(
  inputSchedule: JobSchedule,
  clockNow: UTCTimestamp,
  cronCalc: CronCalculator,
  defaultTimezone: string,
): Result<SchedulePreview> {
  const normalized = normalizeSchedule(inputSchedule, defaultTimezone, clockNow, cronCalc);
  if (!normalized.ok) return normalized;

  const upcoming = upcomingOccurrences(inputSchedule, clockNow, cronCalc);
  if (!upcoming.ok) return upcoming;

  return ok({
    schedule: normalized.value,
    upcoming: upcoming.value,
  });
}

function normalizeSchedule(
  schedule: JobSchedule,
  _defaultTimezone: string,
  clockNow: UTCTimestamp,
  cronCalc: CronCalculator,
): Result<NormalizedSchedule> {
  switch (schedule.kind) {
    case "once": {
      // Normalize for preview - allow past for preview purposes
      const normalized = normalizeOnce(schedule, clockNow, true);
      if (!normalized.ok) return normalized;

      const withDefaults: OnceSchedule = {
        kind: "once",
        runAt: normalized.value.runAt,
        timezone: normalized.value.timezone,
      };

      return ok({
        kind: "once",
        schedule: withDefaults,
        description: `Once at ${normalized.value.runAt} (${normalized.value.timezone})`,
      });
    }

    case "interval": {
      const anchor = resolveIntervalAnchor(schedule, clockNow);

      const withDefaults: JobSchedule = {
        kind: "interval",
        everyMs: schedule.everyMs,
        anchorAt: anchor.anchorAt,
      };

      const intervalMinutes = schedule.everyMs / 60_000;
      const desc =
        intervalMinutes < 60
          ? `Every ${intervalMinutes.toFixed(1)} minutes`
          : intervalMinutes < 1440
            ? `Every ${(intervalMinutes / 60).toFixed(1)} hours`
            : `Every ${(intervalMinutes / 1440).toFixed(1)} days`;

      return ok({
        kind: "interval",
        schedule: withDefaults,
        description: `${desc} (anchor: ${anchor.anchorAt})`,
      });
    }

    case "cron": {
      const v = cronCalc.validate(schedule.expression);
      if (!v.ok) return v;

      return ok({
        kind: "cron",
        schedule,
        description: `Cron "${schedule.expression}" in ${schedule.timezone}`,
      });
    }
  }
}

function upcomingOccurrences(
  schedule: JobSchedule,
  clockNow: UTCTimestamp,
  cronCalc: CronCalculator,
): Result<string[]> {
  switch (schedule.kind) {
    case "once": {
      // A once schedule has exactly one occurrence
      const normalized = normalizeOnce(schedule, clockNow, true);
      if (!normalized.ok) return normalized;
      return ok(normalized.value.runAtMs >= clockNow ? [normalized.value.runAt] : []);
    }

    case "interval": {
      const anchor = resolveIntervalAnchor(schedule, clockNow);
      const result: string[] = [];
      let after = clockNow;

      for (let i = 0; i < 3; i++) {
        const next = nextIntervalOccurrence(anchor, schedule.everyMs, after);
        result.push(next.occurrenceAt);
        after = next.occurrenceMs;
      }

      return ok(result);
    }

    case "cron": {
      const occurrences = cronCalc.nextAfter(schedule.expression, schedule.timezone, clockNow, 3);
      if (!occurrences.ok) return occurrences;
      return ok(occurrences.value.map((o) => o.utcIso));
    }
  }
}

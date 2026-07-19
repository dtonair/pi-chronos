import type { JobSchedule, UTCTimestamp } from "../domain/job.js";
import type { Result } from "../shared/result.js";
import { ok } from "../shared/result.js";
import type { CronCalculator, CronOccurrence } from "./cron.js";
import type { IntervalAnchor, IntervalOccurrence } from "./interval.js";
import { nextIntervalOccurrence, resolveIntervalAnchor } from "./interval.js";
import type { NormalizedOnce } from "./once.js";
import { normalizeOnce } from "./once.js";

// ─── Next-run calculation ─────────────────────────────────────
//
// Pure dispatcher: given a schedule and a clock, produce the next
// occurrence time (if any).

export type NextRunResult =
  | { kind: "once"; occurrence: NormalizedOnce }
  | { kind: "interval"; occurrence: IntervalOccurrence; anchor: IntervalAnchor }
  | { kind: "cron"; occurrence: CronOccurrence }
  | { kind: "none"; reason: string };

/**
 * Calculate the next run occurrence after clockNow for any schedule kind.
 * For once schedules, the occurrence is simply the normalized run time
 * (which may be in the past if allowPast is true).
 */
export function calculateNextRun(
  schedule: JobSchedule,
  clockNow: UTCTimestamp,
  allowPast: boolean,
  cronCalc: CronCalculator,
): Result<NextRunResult> {
  switch (schedule.kind) {
    case "once": {
      const normalized = normalizeOnce(schedule, clockNow, allowPast);
      if (!normalized.ok) return normalized;
      const occ = normalized.value;
      // If the once time is strictly after now, it's the next occurrence.
      // If allowPast and it's in the past, it's still the "next" occurrence
      // (and will be dispatched as the one and only run).
      if (occ.runAtMs >= clockNow || allowPast) {
        return ok({ kind: "once", occurrence: occ });
      }
      // Not in the future and allowPast is false: no next occurrence
      return ok({ kind: "none", reason: "Once schedule is in the past" });
    }

    case "interval": {
      const anchor = resolveIntervalAnchor(schedule, clockNow);
      const occurrence = nextIntervalOccurrence(anchor, schedule.everyMs, clockNow);
      return ok({ kind: "interval", occurrence, anchor });
    }

    case "cron": {
      const occurrences = cronCalc.nextAfter(schedule.expression, schedule.timezone, clockNow, 1);
      if (!occurrences.ok) return occurrences;
      const first = occurrences.value[0];
      if (!first) {
        return ok({ kind: "none", reason: "No future cron occurrences" });
      }
      return ok({ kind: "cron", occurrence: first });
    }
  }
}

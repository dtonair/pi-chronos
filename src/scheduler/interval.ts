import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { IntervalSchedule, UTCTimestamp } from "../domain/job.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

// ─── Fixed-rate interval arithmetic (O(1), no loop) ───────────

export interface IntervalAnchor {
  /** UTC epoch ms of the anchor. */
  anchorMs: UTCTimestamp;
  /** ISO-8601 representation of the anchor. */
  anchorAt: string;
  /** Whether the anchor was supplied or auto-generated. */
  supplied: boolean;
}

export interface IntervalOccurrence {
  /** UTC epoch ms of this occurrence. */
  occurrenceMs: UTCTimestamp;
  /** ISO-8601 representation. */
  occurrenceAt: string;
  /** Zero-based index: (occurrenceMs - anchorMs) / everyMs */
  index: number;
}

/**
 * Resolve the anchor for an interval schedule.
 * If anchorAt is provided and parseable, use it. Otherwise use now.
 */
export function resolveIntervalAnchor(
  schedule: IntervalSchedule,
  clockNow: UTCTimestamp,
): IntervalAnchor {
  if (schedule.anchorAt !== undefined) {
    const anchorMs = Date.parse(schedule.anchorAt);
    if (!Number.isNaN(anchorMs)) {
      return {
        anchorMs: anchorMs as UTCTimestamp,
        anchorAt: schedule.anchorAt,
        supplied: true,
      };
    }
  }
  // Auto-anchor: use current time
  return {
    anchorMs: clockNow,
    anchorAt: new Date(clockNow).toISOString(),
    supplied: false,
  };
}

/**
 * Calculate the next due occurrence after a reference time using O(1) arithmetic.
 *
 * Reference: anchor + ceil((reference - anchor) / interval) * interval
 *
 * If the reference is exactly on an occurrence boundary, the NEXT boundary is
 * returned (not the current one), because the current one has already been
 * dispatched or is currently being dispatched.
 */
export function nextIntervalOccurrence(
  anchor: IntervalAnchor,
  intervalMs: number,
  afterMs: UTCTimestamp,
): IntervalOccurrence {
  const anchorMs = anchor.anchorMs;
  const diff = afterMs - anchorMs;

  // Ceiling division: next occurrence strictly after "afterMs"
  // We want the smallest index such that (anchorMs + index * intervalMs) > afterMs
  // That is: index = floor((afterMs - anchorMs) / intervalMs) + 1
  let index: number;
  if (diff >= 0) {
    index = Math.floor(diff / intervalMs) + 1;
  } else {
    // afterMs is before anchor: the next occurrence is the anchor itself (index 0)
    // unless anchor is also before afterMs, which can't happen if diff < 0
    index = 0;
  }

  const occurrenceMs = (anchorMs + index * intervalMs) as UTCTimestamp;
  return {
    occurrenceMs,
    occurrenceAt: new Date(occurrenceMs).toISOString(),
    index,
  };
}

/**
 * Calculate missed interval occurrences between two reference times.
 *
 * Returns the first missed occurrence, last missed occurrence, and count.
 * If no occurrences were missed, returns undefined.
 */
export function missedIntervalOccurrences(
  anchor: IntervalAnchor,
  intervalMs: number,
  fromMs: UTCTimestamp,
  toMs: UTCTimestamp,
): { first: IntervalOccurrence; last: IntervalOccurrence; count: number } | undefined {
  if (toMs <= fromMs) return undefined;

  // First occurrence after fromMs (exclusive of fromMs)
  const first = nextIntervalOccurrence(anchor, intervalMs, fromMs);

  // Last occurrence before or at toMs
  const diff = toMs - anchor.anchorMs;
  if (diff < 0) return undefined;

  const lastIndex = Math.floor(diff / intervalMs);
  if (lastIndex < first.index) return undefined;

  const lastOccurrenceMs = (anchor.anchorMs + lastIndex * intervalMs) as UTCTimestamp;

  const count = lastIndex - first.index + 1;

  return {
    first,
    last: {
      occurrenceMs: lastOccurrenceMs,
      occurrenceAt: new Date(lastOccurrenceMs).toISOString(),
      index: lastIndex,
    },
    count: Math.min(count, 1_000_000), // bounded
  };
}

/**
 * Validate and normalize an input interval schedule for preview/normalization.
 */
export function normalizeInterval(
  schedule: IntervalSchedule,
  clockNow: UTCTimestamp,
): Result<{ anchor: IntervalAnchor; intervalMs: number }> {
  const anchor = resolveIntervalAnchor(schedule, clockNow);

  if (schedule.everyMs <= 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.INVALID_SCHEDULE,
        message: "Interval must be positive",
      }),
    );
  }

  return ok({ anchor, intervalMs: schedule.everyMs });
}

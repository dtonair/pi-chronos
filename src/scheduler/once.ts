import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { OnceSchedule, UTCTimestamp } from "../domain/job.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

// ─── Once schedule normalization and next-run calculation ──────

export interface NormalizedOnce {
  kind: "once";
  /** Requested input (may be offset-free). */
  requestedRunAt: string;
  /** Normalized UTC ISO-8601 timestamp with milliseconds. */
  runAt: string;
  /** UTC epoch ms of the scheduled occurrence. */
  runAtMs: UTCTimestamp;
  /** IANA timezone resolved from input or default. */
  timezone: string;
}

const ISO_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(z|[+-]\d{2}:\d{2})?$/i;

function hasOffset(iso: string): boolean {
  return /(?:z|[+-]\d{2}:\d{2})$/i.test(iso);
}

/** Convert a local date-time in a given IANA timezone to UTC epoch ms. */
function localToUtcMs(localIso: string, timezone: string): number {
  // localIso is like "2026-08-01T12:00:00" (no Z, no offset)
  // We search for a UTC instant that formats to this local wall time in the target tz.
  const parts = ISO_PATTERN.exec(localIso);
  if (!parts) return NaN;

  const [, dateTime, seconds = "00", millis = "000"] = parts;
  // Build a full ISO string with milliseconds but no timezone, then parse as UTC to get a naive reference
  const fullIso = `${dateTime}:${seconds}.${millis.padEnd(3, "0").slice(0, 3)}`;
  const naiveMs = Date.parse(`${fullIso}Z`);
  if (Number.isNaN(naiveMs)) return NaN;

  // The target wall time string (normalized to consistent format)
  const targetWall = `${dateTime}:${seconds}`;

  // Get a formatter for the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

  // Search ±48h around the naive instant to find a UTC instant that
  // displays as the target wall time in the target timezone.
  // This handles DST transitions where wall times may be repeated or skipped.
  const step = 30 * 60 * 1000; // 30 minutes
  const maxSteps = 96; // 48h each direction

  for (let i = 0; i <= maxSteps; i++) {
    for (const sign of [1, -1]) {
      if (i === 0 && sign === -1) continue; // skip duplicate zero
      const candidate = naiveMs + sign * i * step;
      const trialParts = formatter.formatToParts(new Date(candidate));
      const trialMap: Record<string, string> = {};
      for (const p of trialParts) trialMap[p.type] = p.value;
      const trialFormatted = `${trialMap.year}-${trialMap.month}-${trialMap.day}T${trialMap.hour}:${trialMap.minute}:${trialMap.second}`;
      if (trialFormatted === targetWall) {
        return candidate;
      }
    }
  }

  return NaN;
}

/**
 * Normalize a once schedule: validate, resolve timezone/offset, and produce
 * a single UTC occurrence time.
 */
export function normalizeOnce(
  schedule: OnceSchedule,
  clockNow: UTCTimestamp,
  allowPast: boolean,
): Result<NormalizedOnce> {
  const offsetted = hasOffset(schedule.runAt);

  if (!offsetted && schedule.timezone === undefined) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.INVALID_SCHEDULE,
        message: "An IANA timezone is required when once.runAt has no offset",
      }),
    );
  }

  const timezone = schedule.timezone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.TIMEZONE_INVALID,
        message: `Invalid IANA timezone: ${timezone}`,
        entity: timezone,
      }),
    );
  }

  let runAtMs: number;

  if (offsetted) {
    runAtMs = Date.parse(schedule.runAt);
    if (Number.isNaN(runAtMs)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.INVALID_SCHEDULE,
          message: `Cannot parse once.runAt with offset: ${schedule.runAt}`,
        }),
      );
    }
  } else {
    runAtMs = localToUtcMs(schedule.runAt, timezone);
    if (Number.isNaN(runAtMs)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.INVALID_SCHEDULE,
          message: `Cannot parse once.runAt "${schedule.runAt}" in timezone "${timezone}"`,
        }),
      );
    }
  }

  if (!allowPast && runAtMs < clockNow) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.PAST_ONCE_SCHEDULE,
        message: `Once schedule is in the past: ${schedule.runAt}`,
        entity: schedule.runAt,
      }),
    );
  }

  const normalizedRunAt = new Date(runAtMs).toISOString();

  return ok({
    kind: "once",
    requestedRunAt: schedule.runAt,
    runAt: normalizedRunAt,
    runAtMs: runAtMs as UTCTimestamp,
    timezone,
  });
}

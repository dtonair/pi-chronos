import { CronExpressionParser } from "cron-parser";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { UTCTimestamp } from "../domain/job.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

// ─── Cron schedule calculator ─────────────────────────────────
//
// Wraps cron-parser behind a small interface so the library is
// isolated and replaceable.

export interface CronCalculator {
  /** Validate the expression and return a normalized form. */
  validate(expression: string): Result<NormalizedCron>;
  /** Get the next N occurrences after a reference time. */
  nextAfter(
    expression: string,
    timezone: string,
    afterMs: UTCTimestamp,
    count: number,
  ): Result<CronOccurrence[]>;
}

export interface NormalizedCron {
  expression: string;
  /** Whether the expression represents a valid cron schedule. */
  valid: boolean;
}

export interface CronOccurrence {
  /** UTC epoch ms. */
  utcMs: UTCTimestamp;
  /** ISO-8601 UTC representation. */
  utcIso: string;
  /** The local wall-minute in the schedule's timezone (for DST dedup). */
  localWallMinute: string;
}

// ─── Helpers ──────────────────────────────────────────────

function localWallMinute(utcMs: number, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString();
}

// ─── Production implementation ──────────────────────────────

export function createCronCalculator(): CronCalculator {
  return {
    validate(expression: string): Result<NormalizedCron> {
      const fields = expression.trim().split(/\s+/);
      if (fields.length !== 5) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.INVALID_SCHEDULE,
            message: "Cron expressions must contain exactly five fields",
          }),
        );
      }
      try {
        const parsed = CronExpressionParser.parse(expression, { tz: "UTC" });
        const normalized = parsed.stringify();
        return ok({ expression: normalized, valid: true });
      } catch {
        return err(
          new ChronosError({
            code: ChronosErrorCode.INVALID_SCHEDULE,
            message: `Invalid cron expression: ${expression}`,
          }),
        );
      }
    },

    nextAfter(
      expression: string,
      timezone: string,
      afterMs: UTCTimestamp,
      count: number,
    ): Result<CronOccurrence[]> {
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
      try {
        const currentDate = isoDate(afterMs);
        const parsed = CronExpressionParser.parse(expression, {
          tz: timezone,
          currentDate,
        });

        const results: CronOccurrence[] = [];
        const seen = new Set<string>();
        let pulled = 0;
        const maxPull = count * 3; // safety bound for DST dedup

        while (results.length < count && pulled < maxPull) {
          const next = parsed.next();
          pulled++;

          const utcMs = next.getTime();
          const utcIso = next.toISOString() ?? new Date(utcMs).toISOString();
          const wallMinute = localWallMinute(utcMs, timezone);

          // DST fall-back dedup: skip if we've already produced this wall minute
          if (seen.has(wallMinute)) continue;
          seen.add(wallMinute);

          results.push({
            utcMs: utcMs as UTCTimestamp,
            utcIso,
            localWallMinute: wallMinute,
          });
        }

        return ok(results);
      } catch (err_) {
        return err(
          ChronosError.wrap(
            ChronosErrorCode.INVALID_SCHEDULE,
            `Cron iteration error: ${expression}`,
            err_,
          ),
        );
      }
    },
  };
}

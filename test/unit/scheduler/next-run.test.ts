import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createCronCalculator } from "../../../src/scheduler/cron.js";
import { calculateNextRun } from "../../../src/scheduler/next-run.js";

const cronCalc = createCronCalculator();
const NOW = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp;

describe("calculateNextRun", () => {
  describe("once schedule", () => {
    it("returns the normalized occurrence for a future once", () => {
      const result = calculateNextRun(
        { kind: "once", runAt: "2026-09-01T00:00:00Z" },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe("once");
        if (result.value.kind === "once") {
          expect(result.value.occurrence.runAtMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0, 0));
        }
      }
    });

    it("returns none for a past once without allowPast", () => {
      const result = calculateNextRun(
        { kind: "once", runAt: "2026-07-01T00:00:00Z" },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PAST_ONCE_SCHEDULE");
      }
    });

    it("returns the occurrence for a past once with allowPast", () => {
      const result = calculateNextRun(
        { kind: "once", runAt: "2026-07-01T00:00:00Z" },
        NOW,
        true,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe("once");
      }
    });

    it("returns the normalized once with resolved timezone", () => {
      const result = calculateNextRun(
        {
          kind: "once",
          runAt: "2026-09-01T01:00:00",
          timezone: "Europe/London",
        },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.value.kind === "once") {
        expect(result.value.occurrence.timezone).toBe("Europe/London");
      }
    });
  });

  describe("interval schedule", () => {
    it("returns the next interval occurrence", () => {
      const result = calculateNextRun(
        { kind: "interval", everyMs: 3600_000, anchorAt: "2026-01-01T00:00:00.000Z" },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe("interval");
        if (result.value.kind === "interval") {
          expect(result.value.occurrence.occurrenceMs).toBeGreaterThan(NOW);
          expect(result.value.occurrence.index).toBeGreaterThan(0);
        }
      }
    });

    it("auto-anchors to now when no anchor is provided", () => {
      const result = calculateNextRun(
        { kind: "interval", everyMs: 3600_000 },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.value.kind === "interval") {
        expect(result.value.occurrence.occurrenceMs).toBeGreaterThan(NOW);
      }
    });

    it("handles intervals larger than the timer limit", () => {
      const result = calculateNextRun(
        { kind: "interval", everyMs: 90 * 86_400_000 }, // 90 days
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.value.kind === "interval") {
        expect(result.value.occurrence.occurrenceMs).toBeGreaterThan(NOW);
      }
    });
  });

  describe("cron schedule", () => {
    it("returns the next cron occurrence", () => {
      const result = calculateNextRun(
        { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.kind).toBe("cron");
        if (result.value.kind === "cron") {
          expect(result.value.occurrence.utcMs).toBeGreaterThan(NOW);
        }
      }
    });

    it("returns error for an invalid cron expression", () => {
      const result = calculateNextRun(
        { kind: "cron", expression: "invalid", timezone: "UTC" },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(false);
    });

    it("handles timezone-specific cron", () => {
      const result = calculateNextRun(
        { kind: "cron", expression: "0 9 * * *", timezone: "America/New_York" },
        NOW,
        false,
        cronCalc,
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.value.kind === "cron") {
        // In August, 9:00 EDT = 13:00 UTC. After 12:00 UTC, next is today 13:00 UTC
        expect(result.value.occurrence.utcMs).toBeGreaterThan(NOW);
      }
    });
  });
});

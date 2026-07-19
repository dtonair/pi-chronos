import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createCronCalculator } from "../../../src/scheduler/cron.js";
import { calculateMissedRange } from "../../../src/scheduler/missed-run.js";

const cronCalc = createCronCalculator();
const NOW = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp;
const ANCHOR = Date.UTC(2026, 0, 1, 0, 0, 0, 0) as UTCTimestamp;

describe("calculateMissedRange", () => {
  describe("once schedule", () => {
    it("returns undefined (no missed occurrences for once)", () => {
      const result = calculateMissedRange(
        { kind: "once", runAt: "2026-08-01T12:00:00Z" },
        "skip",
        ANCHOR,
        NOW,
        cronCalc,
      );
      expect(result).toBeUndefined();
    });
  });

  describe("interval schedule - skip policy", () => {
    it("returns missed range when occurrences were missed", () => {
      // Anchor: 2026-01-01. Last scheduled: anchor. Now: Aug 1.
      // With 1-hour interval, many hours were skipped
      const result = calculateMissedRange(
        { kind: "interval", everyMs: 3600_000, anchorAt: "2026-01-01T00:00:00.000Z" },
        "skip",
        ANCHOR,
        NOW,
        cronCalc,
      );
      expect(result).toBeDefined();
      if (result) {
        expect(result.missedCount).toBeGreaterThan(0);
        expect(result.firstMissedAt).toBeDefined();
        expect(result.lastMissedAt).toBeDefined();
      }
    });

    it("returns undefined when no occurrences were missed", () => {
      const result = calculateMissedRange(
        { kind: "interval", everyMs: 3600_000, anchorAt: "2026-01-01T00:00:00.000Z" },
        "skip",
        ANCHOR,
        (ANCHOR + 1800_000) as UTCTimestamp,
        cronCalc,
      );
      expect(result).toBeUndefined();
    });
  });

  describe("interval schedule - run_once policy", () => {
    it("returns missed range for catch-up", () => {
      const result = calculateMissedRange(
        { kind: "interval", everyMs: 3600_000, anchorAt: "2026-01-01T00:00:00.000Z" },
        "run_once",
        ANCHOR,
        NOW,
        cronCalc,
      );
      expect(result).toBeDefined();
      if (result) {
        expect(result.missedCount).toBeGreaterThan(0);
      }
    });
  });

  describe("cron schedule - skip policy", () => {
    it("returns missed range for missed cron occurrences", () => {
      // Daily at 9:00. Last scheduled: 2026-01-01. Now: Aug 1 2026 12:00.
      const result = calculateMissedRange(
        { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
        "skip",
        ANCHOR,
        NOW,
        cronCalc,
      );
      expect(result).toBeDefined();
      if (result) {
        expect(result.missedCount).toBeGreaterThan(0);
        expect(result.missedCount).toBeLessThan(366); // less than a year of days
      }
    });

    it("returns undefined when no cron occurrences were missed", () => {
      const justAfter = Date.UTC(2026, 0, 1, 0, 0, 1, 0) as UTCTimestamp;
      const result = calculateMissedRange(
        { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
        "skip",
        ANCHOR,
        justAfter,
        cronCalc,
      );
      // No occurrences between midnight and 00:00:01
      expect(result).toBeUndefined();
    });
  });

  describe("cron schedule - run_once policy", () => {
    it("returns missed range for catch-up", () => {
      const result = calculateMissedRange(
        { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
        "run_once",
        ANCHOR,
        NOW,
        cronCalc,
      );
      expect(result).toBeDefined();
      if (result) {
        expect(result.missedCount).toBeGreaterThan(0);
      }
    });
  });
});

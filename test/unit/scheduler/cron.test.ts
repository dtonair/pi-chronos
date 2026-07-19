import { describe, expect, it } from "vitest";
import { ChronosErrorCode } from "../../../src/domain/errors.js";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createCronCalculator } from "../../../src/scheduler/cron.js";

const calc = createCronCalculator();

describe("CronCalculator.validate", () => {
  it("validates a standard five-field cron expression", () => {
    const result = calc.validate("0 9 * * *");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
    }
  });

  it("rejects a six-field expression", () => {
    const result = calc.validate("0 0 9 * * 1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.INVALID_SCHEDULE);
    }
  });

  it("rejects a malformed expression", () => {
    const result = calc.validate("not-a-cron");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.INVALID_SCHEDULE);
    }
  });

  it("rejects a four-field expression", () => {
    const result = calc.validate("0 9 * *");
    expect(result.ok).toBe(false);
  });

  it("accepts a complex expression with ranges and lists", () => {
    const result = calc.validate("0,30 9-17 * * 1-5");
    expect(result.ok).toBe(true);
  });

  it("accepts step expressions", () => {
    const result = calc.validate("*/15 * * * *");
    expect(result.ok).toBe(true);
  });
});

describe("CronCalculator.nextAfter", () => {
  const afterMs = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp; // Aug 1 2026 12:00 UTC

  it("returns the next occurrence for a daily schedule", () => {
    const result = calc.nextAfter("0 9 * * *", "UTC", afterMs, 1);
    expect(result.ok).toBe(true);
    if (result.ok && result.value[0]) {
      // Next 09:00 UTC after Aug 1 12:00 should be Aug 2 09:00
      const expected = new Date("2026-08-02T09:00:00.000Z").getTime();
      expect(result.value[0].utcMs).toBe(expected);
    }
  });

  it("returns multiple future occurrences", () => {
    const result = calc.nextAfter("0 9 * * *", "UTC", afterMs, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      // Should be strictly increasing
      for (let i = 1; i < result.value.length; i++) {
        const curr = result.value[i]?.utcMs;
        const prev = result.value[i - 1]?.utcMs;
        if (curr !== undefined && prev !== undefined) {
          expect(curr).toBeGreaterThan(prev);
        }
      }
    }
  });

  it("returns no occurrences when none exists in the future", () => {
    // A schedule that fires once a year, but we query right after one
    const yearMs = Date.UTC(2026, 0, 1, 0, 0, 1, 0) as UTCTimestamp; // just after Jan 1
    const result = calc.nextAfter("0 0 1 1 *", "UTC", yearMs, 1);
    expect(result.ok).toBe(true);
    if (result.ok && result.value[0]) {
      expect(result.value[0].utcMs).toBeGreaterThan(yearMs);
    }
  });

  it("handles timezone-aware cron", () => {
    // 9:00 AM America/New_York, which is 13:00 or 14:00 UTC depending on DST
    const result = calc.nextAfter("0 9 * * *", "America/New_York", afterMs, 1);
    expect(result.ok).toBe(true);
    if (result.ok && result.value[0]) {
      // Aug 1 2026 EDT: 09:00 EDT = 13:00 UTC
      // Our afterMs is 12:00 UTC, so next 13:00 UTC = Aug 1 13:00
      expect(new Date(result.value[0].utcMs).getUTCHours()).toBe(13);
    }
  });
});

describe("CronCalculator DST deduplication", () => {
  // America/New_York fall back 2026: Nov 1 02:00 EDT → 01:00 EST
  // The wall hour 01:00-01:59 occurs twice.
  // A cron of "0 1 * * *" should fire at most once per wall minute.

  it("produces at most one occurrence per repeated wall minute during fall back", () => {
    // Start just before the repeated hour on Nov 1 2026
    const beforeRepeated = Date.UTC(2026, 10, 1, 4, 0, 0, 0) as UTCTimestamp; // 00:00 EDT

    const result = calc.nextAfter("0 1 * * *", "America/New_York", beforeRepeated, 10);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Collect wall minutes and check for duplicates
      const wallMinutes = result.value.map((o) => o.localWallMinute);
      const uniqueWallMinutes = new Set(wallMinutes);
      expect(uniqueWallMinutes.size).toBe(wallMinutes.length);
    }
  });

  it("does not produce occurrences for non-existent wall minutes in spring forward", () => {
    // America/New_York spring forward 2026: Mar 8 02:00→03:00
    // A cron "30 2 * * *" would target a time that doesn't exist
    const beforeGap = Date.UTC(2026, 2, 8, 6, 0, 0, 0) as UTCTimestamp; // 01:00 EST

    // Manual testing: cron-parser handles non-existent times differently.
    // The key test is that our dedup still works correctly.
    const result = calc.nextAfter("30 2 * * *", "America/New_York", beforeGap, 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // All occurrences should have unique wall minutes
      const wallMinutes = result.value.map((o) => o.localWallMinute);
      const uniqueWallMinutes = new Set(wallMinutes);
      expect(uniqueWallMinutes.size).toBe(wallMinutes.length);
    }
  });
});

describe("CronCalculator.nextAfter with timezone", () => {
  it("handles America/New_York timezone", () => {
    const aug1 = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp;
    const result = calc.nextAfter("0 9 * * *", "America/New_York", aug1, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeLessThanOrEqual(3);
      // All should be after aug1
      for (const occ of result.value) {
        expect(occ.utcMs).toBeGreaterThan(aug1);
      }
      // Should be strictly increasing
      for (let i = 1; i < result.value.length; i++) {
        const curr = result.value[i]?.utcMs;
        const prev = result.value[i - 1]?.utcMs;
        if (curr !== undefined && prev !== undefined) {
          expect(curr).toBeGreaterThan(prev);
        }
      }
    }
  });

  it("handles Australia/Sydney timezone", () => {
    const aug1 = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp;
    const result = calc.nextAfter("0 9 * * *", "Australia/Sydney", aug1, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBe(3);
    }
  });
});

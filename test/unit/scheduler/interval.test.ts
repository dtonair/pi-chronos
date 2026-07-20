import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import {
  missedIntervalOccurrences,
  nextIntervalOccurrence,
  resolveIntervalAnchor,
} from "../../../src/scheduler/interval.js";

const FIXED_ANCHOR_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0) as UTCTimestamp; // 2026-01-01T00:00:00Z

describe("resolveIntervalAnchor", () => {
  it("uses the provided anchor when it is valid", () => {
    const anchor = resolveIntervalAnchor(
      { kind: "interval", everyMs: 3600_000, anchorAt: "2026-06-01T12:00:00Z" },
      FIXED_ANCHOR_MS,
    );
    expect(anchor.anchorMs).toBe(Date.UTC(2026, 5, 1, 12, 0, 0, 0));
    expect(anchor.supplied).toBe(true);
  });

  it("falls back to clockNow when anchor is missing", () => {
    const anchor = resolveIntervalAnchor({ kind: "interval", everyMs: 3600_000 }, FIXED_ANCHOR_MS);
    expect(anchor.anchorMs).toBe(FIXED_ANCHOR_MS);
    expect(anchor.supplied).toBe(false);
  });

  it("falls back to clockNow when anchor is unparseable", () => {
    const anchor = resolveIntervalAnchor(
      { kind: "interval", everyMs: 3600_000, anchorAt: "garbage" },
      FIXED_ANCHOR_MS,
    );
    expect(anchor.anchorMs).toBe(FIXED_ANCHOR_MS);
    expect(anchor.supplied).toBe(false);
  });
});

describe("nextIntervalOccurrence", () => {
  const anchor = {
    anchorMs: FIXED_ANCHOR_MS,
    anchorAt: "2026-01-01T00:00:00.000Z",
    supplied: true,
  };
  const intervalMs = 3600_000; // 1 hour

  it("returns the first occurrence after the anchor when afterMs is before anchor", () => {
    const afterMs = (FIXED_ANCHOR_MS - 1000) as UTCTimestamp;
    const occ = nextIntervalOccurrence(anchor, intervalMs, afterMs);
    expect(occ.index).toBe(0);
    expect(occ.occurrenceMs).toBe(FIXED_ANCHOR_MS);
  });

  it("returns the next occurrence when afterMs is at the anchor", () => {
    const occ = nextIntervalOccurrence(anchor, intervalMs, FIXED_ANCHOR_MS);
    expect(occ.index).toBe(1);
    expect(occ.occurrenceMs).toBe((FIXED_ANCHOR_MS + intervalMs) as UTCTimestamp);
  });

  it("returns the next occurrence when afterMs is between occurrences", () => {
    const afterMs = (FIXED_ANCHOR_MS + 1800_000) as UTCTimestamp; // +30 min
    const occ = nextIntervalOccurrence(anchor, intervalMs, afterMs);
    expect(occ.index).toBe(1);
    expect(occ.occurrenceMs).toBe((FIXED_ANCHOR_MS + intervalMs) as UTCTimestamp);
  });

  it("returns the next occurrence when afterMs is exactly on an occurrence", () => {
    const afterMs = (FIXED_ANCHOR_MS + intervalMs) as UTCTimestamp; // exactly at index 1
    const occ = nextIntervalOccurrence(anchor, intervalMs, afterMs);
    expect(occ.index).toBe(2); // next, not current
    expect(occ.occurrenceMs).toBe((FIXED_ANCHOR_MS + 2 * intervalMs) as UTCTimestamp);
  });

  it("handles arbitrary large intervals", () => {
    const dayMs = 86_400_000;
    const afterMs = (FIXED_ANCHOR_MS + 365 * dayMs) as UTCTimestamp; // +365 days = anchor + 365*day
    // nextOccurrence returns strictly after afterMs, so index = floor(365*day/day) + 1 = 366
    const occ = nextIntervalOccurrence(anchor, dayMs, afterMs);
    expect(occ.index).toBe(366);
    expect(occ.occurrenceMs).toBe((FIXED_ANCHOR_MS + 366 * dayMs) as UTCTimestamp);
  });

  it("handles a very large interval beyond timer limit", () => {
    const hugeInterval = 90 * 86_400_000; // 90 days
    // 180 days after anchor with 90-day interval: floor(180/90) + 1 = 3
    const afterMs = (FIXED_ANCHOR_MS + 180 * 86_400_000) as UTCTimestamp;
    const occ = nextIntervalOccurrence(anchor, hugeInterval, afterMs);
    expect(occ.index).toBe(3);
  });

  it("maintains O(1) arithmetic regardless of distance", () => {
    // Performance: this is constant time, not a loop
    const dayMs = 86_400_000;
    const farFuture = (FIXED_ANCHOR_MS + 1000 * 365 * dayMs) as UTCTimestamp;
    const start = performance.now();
    const occ = nextIntervalOccurrence(anchor, dayMs, farFuture);
    const elapsed = performance.now() - start;
    // Should be nearly instant (well under 1ms)
    expect(elapsed).toBeLessThan(10);
    expect(occ.index).toBeGreaterThan(0);
  });
});

describe("interval arithmetic property checks", () => {
  it("matches a bounded reference for generated anchors and intervals", () => {
    let seed = 0x1234_5678;
    const nextRandom = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let sample = 0; sample < 500; sample += 1) {
      const anchorMs = (FIXED_ANCHOR_MS + Math.floor(nextRandom() * 10_000_000)) as UTCTimestamp;
      const intervalMs = 1 + Math.floor(nextRandom() * 1_000_000);
      const afterMs = (anchorMs - 2_000_000 + Math.floor(nextRandom() * 6_000_000)) as UTCTimestamp;
      const actual = nextIntervalOccurrence(
        { anchorMs, anchorAt: new Date(anchorMs).toISOString(), supplied: true },
        intervalMs,
        afterMs,
      );
      let expectedIndex = 0;
      while (anchorMs + expectedIndex * intervalMs <= afterMs) expectedIndex += 1;
      expect(actual.index).toBe(expectedIndex);
      expect(actual.occurrenceMs).toBe(anchorMs + expectedIndex * intervalMs);
    }
  });
});

describe("missedIntervalOccurrences", () => {
  const anchor = {
    anchorMs: FIXED_ANCHOR_MS,
    anchorAt: "2026-01-01T00:00:00.000Z",
    supplied: true,
  };
  const intervalMs = 3600_000; // 1 hour

  it("returns undefined when no occurrences were missed", () => {
    const fromMs = FIXED_ANCHOR_MS;
    const toMs = (FIXED_ANCHOR_MS + 1800_000) as UTCTimestamp; // less than one interval
    const result = missedIntervalOccurrences(anchor, intervalMs, fromMs, toMs);
    expect(result).toBeUndefined();
  });

  it("returns one missed occurrence when one interval was skipped", () => {
    const fromMs = FIXED_ANCHOR_MS;
    const toMs = (FIXED_ANCHOR_MS + 3600_000) as UTCTimestamp; // exactly one interval
    const result = missedIntervalOccurrences(anchor, intervalMs, fromMs, toMs);
    expect(result).toBeDefined();
    expect(result?.count).toBe(1);
    expect(result?.first.index).toBe(1);
    // toMs is exactly at the occurrence, so it counts as missed too (floor inclusion)
  });

  it("returns multiple missed occurrences", () => {
    const fromMs = FIXED_ANCHOR_MS;
    const toMs = (FIXED_ANCHOR_MS + 5 * intervalMs) as UTCTimestamp;
    const result = missedIntervalOccurrences(anchor, intervalMs, fromMs, toMs);
    expect(result).toBeDefined();
    expect(result?.count).toBe(5);
    expect(result?.first.index).toBe(1);
    expect(result?.last.index).toBe(5);
  });

  it("returns undefined when toMs is before fromMs", () => {
    const fromMs = (FIXED_ANCHOR_MS + intervalMs) as UTCTimestamp;
    const toMs = FIXED_ANCHOR_MS;
    const result = missedIntervalOccurrences(anchor, intervalMs, fromMs, toMs);
    expect(result).toBeUndefined();
  });

  it("returns undefined when fromMs equals toMs", () => {
    const result = missedIntervalOccurrences(anchor, intervalMs, FIXED_ANCHOR_MS, FIXED_ANCHOR_MS);
    expect(result).toBeUndefined();
  });

  it("handles long downtime with many missed occurrences", () => {
    const fromMs = FIXED_ANCHOR_MS;
    // 7 days of missed hourly runs
    const toMs = (FIXED_ANCHOR_MS + 7 * 24 * 3600_000) as UTCTimestamp;
    const result = missedIntervalOccurrences(anchor, intervalMs, fromMs, toMs);
    expect(result).toBeDefined();
    expect(result?.count).toBe(7 * 24);
  });
});

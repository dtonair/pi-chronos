import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import {
  calculateTimerDelay,
  isDelayClamped,
  shouldRecalculate,
} from "../../../src/scheduler/timer-delay.js";

const MAX_TIMEOUT = 2_147_000_000; // ~24.85 days
const NOW = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp;

describe("calculateTimerDelay", () => {
  it("returns 0 when the occurrence is now", () => {
    expect(calculateTimerDelay(NOW, NOW, MAX_TIMEOUT)).toBe(0);
  });

  it("returns 0 when the occurrence is in the past", () => {
    const past = (NOW - 1000) as UTCTimestamp;
    expect(calculateTimerDelay(past, NOW, MAX_TIMEOUT)).toBe(0);
  });

  it("returns the exact delay for a near-future occurrence", () => {
    const future = (NOW + 60_000) as UTCTimestamp; // 1 minute
    expect(calculateTimerDelay(future, NOW, MAX_TIMEOUT)).toBe(60_000);
  });

  it("clamps the delay to maxTimeoutMs", () => {
    const farFuture = (NOW + 3 * MAX_TIMEOUT) as UTCTimestamp;
    expect(calculateTimerDelay(farFuture, NOW, MAX_TIMEOUT)).toBe(MAX_TIMEOUT);
  });

  it("handles a delay just below the clamp", () => {
    const future = (NOW + MAX_TIMEOUT - 1) as UTCTimestamp;
    expect(calculateTimerDelay(future, NOW, MAX_TIMEOUT)).toBe(MAX_TIMEOUT - 1);
  });

  it("handles a delay exactly at the clamp", () => {
    const future = (NOW + MAX_TIMEOUT) as UTCTimestamp;
    expect(calculateTimerDelay(future, NOW, MAX_TIMEOUT)).toBe(MAX_TIMEOUT);
  });
});

describe("isDelayClamped", () => {
  it("returns false when delay is within bounds", () => {
    const future = (NOW + 60_000) as UTCTimestamp;
    expect(isDelayClamped(future, NOW, MAX_TIMEOUT)).toBe(false);
  });

  it("returns true when delay exceeds maxTimeoutMs", () => {
    const farFuture = (NOW + MAX_TIMEOUT + 1) as UTCTimestamp;
    expect(isDelayClamped(farFuture, NOW, MAX_TIMEOUT)).toBe(true);
  });

  it("returns false when delay exactly equals maxTimeoutMs", () => {
    const future = (NOW + MAX_TIMEOUT) as UTCTimestamp;
    expect(isDelayClamped(future, NOW, MAX_TIMEOUT)).toBe(false);
  });
});

describe("shouldRecalculate", () => {
  it("delegates to isDelayClamped", () => {
    const nearFuture = (NOW + 60_000) as UTCTimestamp;
    const farFuture = (NOW + MAX_TIMEOUT + 1) as UTCTimestamp;

    expect(shouldRecalculate(nearFuture, NOW, MAX_TIMEOUT)).toBe(false);
    expect(shouldRecalculate(farFuture, NOW, MAX_TIMEOUT)).toBe(true);
  });
});

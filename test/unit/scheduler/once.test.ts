import { describe, expect, it } from "vitest";
import { ChronosErrorCode } from "../../../src/domain/errors.js";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { normalizeOnce } from "../../../src/scheduler/once.js";

// Fixed "now" for deterministic tests: 2026-08-01T12:00:00Z
const NOW_MS = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp;

describe("normalizeOnce", () => {
  // ── ISO timestamps with offsets ───────────────────────────

  it("normalizes an ISO timestamp with Z offset", () => {
    const result = normalizeOnce({ kind: "once", runAt: "2026-09-01T00:00:00Z" }, NOW_MS, false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runAt).toBe("2026-09-01T00:00:00.000Z");
      expect(result.value.runAtMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0, 0));
      expect(result.value.timezone).toBe("UTC");
    }
  });

  it("normalizes an ISO timestamp with +HH:MM offset", () => {
    const result = normalizeOnce(
      { kind: "once", runAt: "2026-09-01T05:00:00+05:00" },
      NOW_MS,
      false,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runAt).toBe("2026-09-01T00:00:00.000Z");
      expect(result.value.runAtMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0, 0));
    }
  });

  it("normalizes an ISO timestamp with -HH:MM offset", () => {
    const result = normalizeOnce(
      { kind: "once", runAt: "2026-08-31T20:00:00-04:00" },
      NOW_MS,
      false,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.runAtMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0, 0));
    }
  });

  // ── ISO timestamps without offsets ────────────────────────

  it("normalizes an offset-free ISO with a provided timezone", () => {
    const result = normalizeOnce(
      {
        kind: "once",
        runAt: "2026-09-01T01:00:00",
        timezone: "Europe/London",
      },
      NOW_MS,
      false,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.timezone).toBe("Europe/London");
      // Sept 1 2026 01:00 BST (UTC+1) → 2026-08-31T23:59:59? No...
      // Actually in Sept 2026, UK is BST (UTC+1). So 01:00 BST = 00:00 UTC
      expect(result.value.runAtMs).toBe(Date.UTC(2026, 8, 1, 0, 0, 0, 0));
    }
  });

  it("normalizes a local timestamp in a negative-offset timezone", () => {
    const result = normalizeOnce(
      {
        kind: "once",
        runAt: "2026-09-01T00:00:00",
        timezone: "America/New_York",
      },
      NOW_MS,
      false,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Sept 1 2026 00:00 EDT (UTC-4) → 04:00 UTC
      expect(result.value.runAtMs).toBe(Date.UTC(2026, 8, 1, 4, 0, 0, 0));
    }
  });

  // ── Past rejection ────────────────────────────────────────

  it("rejects a past timestamp with PAST_ONCE_SCHEDULE", () => {
    const result = normalizeOnce({ kind: "once", runAt: "2026-07-01T00:00:00Z" }, NOW_MS, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.PAST_ONCE_SCHEDULE);
    }
  });

  it("accepts a past timestamp when allowPast is true", () => {
    const result = normalizeOnce({ kind: "once", runAt: "2026-07-01T00:00:00Z" }, NOW_MS, true);
    expect(result.ok).toBe(true);
  });

  it("accepts a timestamp equal to now", () => {
    const result = normalizeOnce({ kind: "once", runAt: "2026-08-01T12:00:00Z" }, NOW_MS, false);
    expect(result.ok).toBe(true);
  });

  it("rejects a timestamp one ms before now", () => {
    const result = normalizeOnce(
      { kind: "once", runAt: "2026-08-01T11:59:59.999Z" },
      NOW_MS,
      false,
    );
    expect(result.ok).toBe(false);
  });

  // ── Malformed input ───────────────────────────────────────

  it("rejects a malformed timestamp", () => {
    const result = normalizeOnce({ kind: "once", runAt: "not-a-date" }, NOW_MS, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.INVALID_SCHEDULE);
    }
  });

  it("rejects an offset-free timestamp without a timezone", () => {
    const result = normalizeOnce({ kind: "once", runAt: "2026-09-01T00:00:00" }, NOW_MS, false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.INVALID_SCHEDULE);
      expect(result.error.message).toContain("timezone");
    }
  });

  // ── DST edge cases ────────────────────────────────────────

  it("rejects a timestamp in a DST spring-forward gap", () => {
    // 2026-03-08T02:30:00 America/New_York does not exist
    // (clocks jump from 01:59:59 EST to 03:00:00 EDT)
    const result = normalizeOnce(
      {
        kind: "once",
        runAt: "2026-03-08T02:30:00",
        timezone: "America/New_York",
      },
      Date.UTC(2026, 0, 1, 0, 0, 0, 0) as UTCTimestamp,
      true,
    );
    // Non-existent wall times should be rejected
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.INVALID_SCHEDULE);
    }
  });

  it("handles a timestamp during DST fall-back repeated hour", () => {
    // 2026-11-01T01:30:00 America/New_York occurs twice
    // The implementation should pick one consistently (first occurrence)
    const result = normalizeOnce(
      {
        kind: "once",
        runAt: "2026-11-01T01:30:00",
        timezone: "America/New_York",
      },
      Date.UTC(2026, 0, 1, 0, 0, 0, 0) as UTCTimestamp,
      true,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Number.isNaN(result.value.runAtMs)).toBe(false);
    }
  });
});

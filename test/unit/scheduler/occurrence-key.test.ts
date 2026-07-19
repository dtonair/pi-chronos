import { describe, expect, it } from "vitest";
import {
  cronOccurrenceKey,
  intervalOccurrenceKey,
  occurrenceKeyFor,
  onceOccurrenceKey,
} from "../../../src/scheduler/occurrence-key.js";

describe("occurrence key generation", () => {
  it("generates a deterministic once key", () => {
    const key = onceOccurrenceKey({
      kind: "once",
      runAt: "2026-09-01T00:00:00.000Z",
    });
    expect(key).toBe("once:2026-09-01T00:00:00.000Z");
  });

  it("generates a deterministic interval key", () => {
    const key = intervalOccurrenceKey({ kind: "interval", everyMs: 3600_000 }, 42);
    expect(key).toBe("interval:3600000:42");
  });

  it("generates a deterministic cron key", () => {
    const key = cronOccurrenceKey(
      { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
      "2026-09-01T09:00:00.000Z",
    );
    expect(key).toBe("cron:0 9 * * *:UTC:2026-09-01T09:00:00.000Z");
  });

  it("generates unique keys for different occurrences of the same schedule", () => {
    const key1 = cronOccurrenceKey(
      { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
      "2026-09-01T09:00:00.000Z",
    );
    const key2 = cronOccurrenceKey(
      { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
      "2026-09-02T09:00:00.000Z",
    );
    expect(key1).not.toBe(key2);
  });

  it("generates unique keys for different schedules at the same time", () => {
    const key1 = cronOccurrenceKey(
      { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
      "2026-09-01T09:00:00.000Z",
    );
    const key2 = cronOccurrenceKey(
      { kind: "cron", expression: "30 9 * * *", timezone: "UTC" },
      "2026-09-01T09:00:00.000Z",
    );
    expect(key1).not.toBe(key2);
  });

  describe("occurrenceKeyFor", () => {
    it("generates a once key from the schedule and ISO", () => {
      const key = occurrenceKeyFor(
        { kind: "once", runAt: "2026-09-01T00:00:00.000Z" },
        "2026-09-01T00:00:00.000Z",
      );
      expect(key).toBe("once:2026-09-01T00:00:00.000Z");
    });

    it("generates an interval key with computed index", () => {
      const key = occurrenceKeyFor(
        { kind: "interval", everyMs: 3600_000, anchorAt: "2026-01-01T00:00:00.000Z" },
        "2026-01-01T03:00:00.000Z",
      );
      // anchor + 3 * 3600000 = 3 hours after anchor
      expect(key).toBe("interval:3600000:3");
    });

    it("generates a cron key", () => {
      const key = occurrenceKeyFor(
        { kind: "cron", expression: "0 9 * * *", timezone: "America/New_York" },
        "2026-09-01T13:00:00.000Z",
      );
      expect(key).toBe("cron:0 9 * * *:America/New_York:2026-09-01T13:00:00.000Z");
    });
  });
});

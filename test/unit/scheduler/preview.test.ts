import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { createCronCalculator } from "../../../src/scheduler/cron.js";
import { previewSchedule } from "../../../src/scheduler/preview.js";

const cronCalc = createCronCalculator();
const NOW = Date.UTC(2026, 7, 1, 12, 0, 0, 0) as UTCTimestamp;
const UTC = "UTC";

describe("previewSchedule", () => {
  describe("once schedule", () => {
    it("returns the normalized once schedule", () => {
      const result = previewSchedule(
        { kind: "once", runAt: "2026-09-01T00:00:00Z" },
        NOW,
        cronCalc,
        UTC,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.schedule.kind).toBe("once");
        // One occurrence in the future
        expect(result.value.upcoming).toHaveLength(1);
        expect(result.value.upcoming[0]).toBe("2026-09-01T00:00:00.000Z");
      }
    });

    it("returns empty upcoming for a past once schedule", () => {
      const result = previewSchedule(
        { kind: "once", runAt: "2026-07-01T00:00:00Z" },
        NOW,
        cronCalc,
        UTC,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.upcoming).toHaveLength(0);
      }
    });

    it("resolves the timezone for offset-free input", () => {
      const result = previewSchedule(
        {
          kind: "once",
          runAt: "2026-09-01T01:00:00",
          timezone: "America/New_York",
        },
        NOW,
        cronCalc,
        UTC,
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.value.schedule.kind === "once") {
        const sched = result.value.schedule
          .schedule as import("../../../src/domain/job.js").OnceSchedule;
        expect(sched.timezone).toBe("America/New_York");
      }
    });
  });

  describe("interval schedule", () => {
    it("returns three upcoming occurrences", () => {
      const result = previewSchedule({ kind: "interval", everyMs: 3600_000 }, NOW, cronCalc, UTC);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.schedule.kind).toBe("interval");
        expect(result.value.upcoming).toHaveLength(3);
        // All upcoming should be after now
        for (const occ of result.value.upcoming) {
          expect(new Date(occ).getTime()).toBeGreaterThan(NOW);
        }
        // Should be strictly increasing
        const upcoming = result.value.upcoming;
        for (let i = 1; i < upcoming.length; i++) {
          const curr = upcoming[i];
          const prev = upcoming[i - 1];
          if (curr && prev) {
            expect(new Date(curr).getTime()).toBeGreaterThan(new Date(prev).getTime());
          }
        }
      }
    });

    it("auto-anchors when no anchor is provided", () => {
      const result = previewSchedule({ kind: "interval", everyMs: 3600_000 }, NOW, cronCalc, UTC);
      expect(result.ok).toBe(true);
      if (result.ok && result.value.schedule.kind === "interval") {
        // Schedules with auto-anchor are normalized with the current time as anchor
        expect(result.value.schedule.description).toContain("anchor");
      }
    });

    it("handles daily intervals", () => {
      const result = previewSchedule({ kind: "interval", everyMs: 86_400_000 }, NOW, cronCalc, UTC);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.schedule.description).toContain("days");
      }
    });
  });

  describe("cron schedule", () => {
    it("returns three upcoming occurrences", () => {
      const result = previewSchedule(
        { kind: "cron", expression: "0 9 * * *", timezone: "UTC" },
        NOW,
        cronCalc,
        UTC,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.schedule.kind).toBe("cron");
        expect(result.value.upcoming).toHaveLength(3);
        // All upcoming should be after now
        for (const occ of result.value.upcoming) {
          expect(new Date(occ).getTime()).toBeGreaterThan(NOW);
        }
        // Should be strictly increasing
        const upcoming = result.value.upcoming;
        for (let i = 1; i < upcoming.length; i++) {
          const curr = upcoming[i];
          const prev = upcoming[i - 1];
          if (curr && prev) {
            expect(new Date(curr).getTime()).toBeGreaterThan(new Date(prev).getTime());
          }
        }
      }
    });

    it("returns error for invalid cron expression", () => {
      const result = previewSchedule(
        { kind: "cron", expression: "invalid cron", timezone: "UTC" },
        NOW,
        cronCalc,
        UTC,
      );
      expect(result.ok).toBe(false);
    });

    it("returns a human-readable description", () => {
      const result = previewSchedule(
        { kind: "cron", expression: "0 9 * * 1-5", timezone: "America/New_York" },
        NOW,
        cronCalc,
        UTC,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.schedule.description).toContain("0 9 * * 1-5");
        expect(result.value.schedule.description).toContain("America/New_York");
      }
    });
  });
});

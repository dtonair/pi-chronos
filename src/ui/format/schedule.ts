import type { JobSchedule } from "../../domain/job.js";
import { formatCalendarTime } from "./relative-time.js";

export function formatSchedule(schedule: JobSchedule, now = Date.now()): string {
  switch (schedule.kind) {
    case "once": {
      const parsed = Date.parse(schedule.runAt);
      return Number.isNaN(parsed)
        ? "once"
        : `once · ${formatCalendarTime(parsed, now, schedule.timezone ?? "UTC")}`;
    }
    case "interval":
      return `every ${formatInterval(schedule.everyMs)}`;
    case "cron":
      return `cron ${schedule.expression}`;
    default: {
      const exhaustive: never = schedule;
      return String(exhaustive);
    }
  }
}

function formatInterval(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "unknown";
  if (milliseconds % 86_400_000 === 0) return `${milliseconds / 86_400_000}d`;
  if (milliseconds % 3_600_000 === 0) return `${milliseconds / 3_600_000}h`;
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000}m`;
  if (milliseconds % 1_000 === 0) return `${milliseconds / 1_000}s`;
  return `${milliseconds}ms`;
}

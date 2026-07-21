import { formatDuration } from "./duration.js";

export function formatRelativeTime(timestamp: number | null | undefined, now: number): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp))
    return "unknown";
  if (!Number.isFinite(now)) return "unknown";
  const delta = timestamp - now;
  const abs = Math.abs(delta);
  if (abs < 1_000) return "now";
  const value = formatDuration(abs);
  return delta > 0 ? `in ${value}` : `${value} ago`;
}

/** A deterministic calendar label useful alongside a relative label. */
export function formatCalendarTime(
  timestamp: number | null | undefined,
  now: number,
  timezone = "UTC",
): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return "none";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const date = `${values.day} ${values.month} ${values.year}`;
    const currentParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).formatToParts(new Date(now));
    const currentDate = `${currentParts.find((part) => part.type === "day")?.value} ${currentParts.find((part) => part.type === "month")?.value} ${currentParts.find((part) => part.type === "year")?.value}`;
    const hour = `${values.hour}:${values.minute}`;
    if (date === currentDate) return `Today ${hour}`;
    const tomorrow = new Date(now + 86_400_000);
    const tomorrowParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).formatToParts(tomorrow);
    const tomorrowDate = `${tomorrowParts.find((part) => part.type === "day")?.value} ${tomorrowParts.find((part) => part.type === "month")?.value} ${tomorrowParts.find((part) => part.type === "year")?.value}`;
    if (date === tomorrowDate) return `Tomorrow ${hour}`;
    return `${date} ${hour}`;
  } catch {
    return new Date(timestamp).toISOString();
  }
}

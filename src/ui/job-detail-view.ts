import { Text } from "@earendil-works/pi-tui";
import type { Job } from "../domain/job.js";
import { formatDuration } from "./format/duration.js";
import { formatPermissions } from "./format/permissions.js";
import { formatCalendarTime, formatRelativeTime } from "./format/relative-time.js";
import { keyValue, truncate } from "./layout.js";
import { type JobDetailViewModel, mapJobToDetail } from "./view-models.js";

export interface JobDetailRenderOptions {
  width?: number;
  now?: number;
}

export function renderJobDetail(
  input: Job | JobDetailViewModel,
  options: JobDetailRenderOptions = {},
): string {
  const width = Math.max(24, options.width ?? 80);
  const now = options.now ?? Date.now();
  const view = isDetailViewModel(input) ? input : mapJobToDetail(input, now);
  const state = `${view.stateSymbol} ${view.state.toUpperCase()}`;
  const lines = [
    truncate(`${view.name.toUpperCase()}  ${state}`, width),
    "",
    "Schedule",
    keyValue("Schedule", scheduleValue(view), width),
    ...(view.timezone ? [keyValue("Timezone", view.timezone, width)] : []),
    keyValue("Next", timestampValue(view.nextRunAt, now, view.timezone), width),
    keyValue("Last", timestampValue(view.lastRunAt, now, view.timezone), width),
    "",
    "Execution",
    keyValue("Model", view.model, width),
    keyValue("Directory", view.workingDirectory, width),
    keyValue("Timeout", formatDuration(view.timeoutMs), width),
    keyValue("Output limit", formatBytes(view.maxOutputBytes), width),
    keyValue("Overlap", view.overlapPolicy, width),
    keyValue(
      "Missed",
      view.missedRunPolicy === "run_once" ? "run once" : view.missedRunPolicy,
      width,
    ),
    keyValue("Sandbox", view.sandboxRequired ? "required" : "disabled", width),
    "",
    "Permissions",
    ...formatPermissions(view.permissions).map((row) => keyValue(row.label, row.value, width)),
    "",
    "Status",
    keyValue("State", `${view.state} (${view.stateSymbol})`, width),
    keyValue("Failures", String(view.failureCount), width),
    keyValue("Diagnostic", view.diagnostic ?? "none", width),
    "",
    "Prompt",
    `  ${truncate(oneLine(view.prompt), Math.max(1, width - 2))}`,
    "  Full prompt hidden from the compact view",
    "",
    "Approval",
    keyValue("Fingerprint", abbreviateFingerprint(view.fingerprint), width),
    keyValue(
      "Decision",
      view.approved ? "approved" : view.state === "approval" ? "approval required" : "not required",
      width,
    ),
    "",
    "Metadata",
    keyValue("Job ID", abbreviateId(view.id), width),
  ];
  if (view.description) lines.splice(2, 0, `  ${truncate(oneLine(view.description), width - 2)}`);
  return lines.map((line) => truncate(line, width)).join("\n");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${Math.round(value / 1_024)} KiB`;
  return `${Math.round(value / 1_048_576)} MiB`;
}

function scheduleValue(view: JobDetailViewModel): string {
  if (view.scheduleKind === "cron")
    return view.scheduleExpression ? `Cron ${view.scheduleExpression}` : "Cron";
  if (view.scheduleKind === "once")
    return view.scheduleExpression ? `Once ${view.scheduleExpression}` : "Once";
  return `Interval ${view.scheduleLabel}`;
}

function timestampValue(timestamp: number | null, now: number, timezone?: string): string {
  if (timestamp === null) return "none";
  const calendar = formatCalendarTime(timestamp, now, timezone ?? "UTC");
  return `${calendar} · ${formatRelativeTime(timestamp, now)}`;
}

function isDetailViewModel(value: Job | JobDetailViewModel): value is JobDetailViewModel {
  return "workingDirectory" in value && "permissions" in value && "failureCount" in value;
}

export function abbreviateFingerprint(fingerprint: string): string {
  if (fingerprint.length <= 14) return fingerprint;
  return `${fingerprint.slice(0, 6)}…${fingerprint.slice(-6)}`;
}

export function abbreviateId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function oneLine(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createJobDetailView(
  job: Job | JobDetailViewModel,
  options: JobDetailRenderOptions = {},
): Text {
  return new Text(renderJobDetail(job, options), 0, 0);
}

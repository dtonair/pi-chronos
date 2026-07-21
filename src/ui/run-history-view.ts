import { Text } from "@earendil-works/pi-tui";
import type { Run } from "../domain/run.js";
import { formatDuration } from "./format/duration.js";
import { formatCalendarTime, formatRelativeTime } from "./format/relative-time.js";
import { abbreviateId } from "./job-detail-view.js";
import { truncate } from "./layout.js";
import { mapRunToHistoryItem, type RunHistoryItem, runStatusSymbol } from "./view-models.js";

export interface HistoryRenderOptions {
  width?: number;
  now?: number;
}

export function renderRunHistory(
  runs: readonly Run[] | readonly RunHistoryItem[],
  options: HistoryRenderOptions = {},
): string[] {
  const width = Math.max(24, options.width ?? 80);
  const now = options.now ?? Date.now();
  const first = runs[0];
  const items =
    first !== undefined && "timing" in first
      ? (runs as readonly Run[]).map(mapRunToHistoryItem)
      : [...(runs as readonly RunHistoryItem[])];
  if (items.length === 0) return ["RUN HISTORY", "No runs yet."];
  return [
    "RUN HISTORY",
    ...items.map((run) => {
      const when = `${formatCalendarTime(run.occurrenceAt, now)} · ${formatRelativeTime(run.occurrenceAt, now)}`;
      const duration =
        run.status === "skipped" || run.status === "cancelled"
          ? run.status
          : formatDuration(run.durationMs);
      const summary = run.summary || "no output";
      const attempt = run.attempt > 1 ? ` attempt ${run.attempt}` : "";
      return truncate(
        `${runStatusSymbol(run.status)} ${when}  ${duration.padStart(8)}  ${truncate(summary, Math.max(8, width - 45))}  [${abbreviateId(run.id)}]${attempt}`,
        width,
      );
    }),
  ];
}

export function formatRun(run: Run): string {
  return renderRunHistory([run], { width: 200, now: Date.now() }).at(1) ?? abbreviateId(run.id);
}

export function createRunHistoryView(
  runs: readonly Run[] | readonly RunHistoryItem[],
  options: HistoryRenderOptions = {},
): Text {
  return new Text(renderRunHistory(runs, options).join("\n"), 0, 0);
}

import { Text } from "@earendil-works/pi-tui";
import type { Run } from "../domain/run.js";
import { formatRun } from "./formatters.js";
export function renderRunHistory(runs: readonly Run[]): string[] {
  return runs.map(formatRun);
}

/** Documented Pi TUI component for a bounded run-history page. */
export function createRunHistoryView(runs: readonly Run[]): Text {
  return new Text(renderRunHistory(runs).join("\n"), 0, 0);
}

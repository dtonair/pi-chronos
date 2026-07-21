import { Text } from "@earendil-works/pi-tui";
import { renderCompactDashboard } from "./dashboard-view.js";
import { renderJobDetail } from "./job-detail-view.js";
import { renderJobTable } from "./jobs-view.js";
import { truncate } from "./layout.js";
import { renderRunHistory } from "./run-history-view.js";
import { formatStatus } from "./status.js";
import type { ChronosWorkspaceState } from "./view-models.js";

/** The one Text adapter used by all Chronos TUI screens. */
export function createChronosWorkspaceView(state: ChronosWorkspaceState): Text {
  return new ChronosWorkspaceText(state);
}

class ChronosWorkspaceText extends Text {
  private readonly workspaceState: ChronosWorkspaceState;

  constructor(state: ChronosWorkspaceState) {
    super("", 0, 0);
    this.workspaceState = state;
  }

  override render(width: number): string[] {
    return new Text(renderChronosWorkspace(this.workspaceState, width), 0, 0).render(width);
  }
}

export function renderChronosWorkspace(state: ChronosWorkspaceState, width = 80): string {
  const notification = state.notification
    ? `${truncate(state.notification.message, width)}\n\n`
    : "";
  switch (state.mode) {
    case "compact":
      return notification + renderCompactDashboard(state, { width });
    case "jobs":
      return notification + renderJobTable(state.jobs, { width }).join("\n");
    case "job-detail":
      return (
        notification +
        (state.selectedJob ? renderJobDetail(state.selectedJob, { width }) : "No job selected.")
      );
    case "history":
      return notification + renderRunHistory(state.runs, { width }).join("\n");
    case "health":
      return (
        notification + (state.health ? formatStatus(state.health) : "Chronos health unavailable.")
      );
    case "approval":
      return (
        notification +
        (state.approvalLines.length > 0 ? state.approvalLines.join("\n") : "No definition changes.")
      );
    default: {
      const exhaustive: never = state.mode;
      return exhaustive;
    }
  }
}

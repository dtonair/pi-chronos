import { describe, expect, it } from "vitest";
import { validateCreateDialog } from "../../../src/ui/create-dialog.js";
import { formatJob, formatRun } from "../../../src/ui/formatters.js";
import { createJobDetailView, renderJobDetail } from "../../../src/ui/job-detail-view.js";
import { createJobsView, renderJobs } from "../../../src/ui/jobs-view.js";
import { createRunHistoryView, renderRunHistory } from "../../../src/ui/run-history-view.js";
import { createStatusView, formatStatus } from "../../../src/ui/status.js";
import { createTestJob, createTestRun } from "../../fixtures/database.js";

describe("TUI presentation adapters", () => {
  it("renders jobs, details, runs, and health without side effects", () => {
    const job = createTestJob({ id: "ui-job", nextRunAt: null });
    const run = createTestRun({ id: "ui-run", jobId: job.id });
    expect(formatJob(job)).toContain("next=none");
    expect(renderJobs([job])).toHaveLength(1);
    expect(createJobsView([job]).render(80).join("\n")).toContain("test-job");
    expect(renderJobDetail(job)).toContain('"ui-job"');
    expect(createJobDetailView(job).render(80).join("\n")).toContain("ui-job");
    expect(formatRun(run)).toContain("ui-run");
    expect(renderRunHistory([run])).toHaveLength(1);
    expect(createRunHistoryView([run]).render(80).join("\n")).toContain("ui-run");
    expect(
      formatStatus({
        databaseState: "ready",
        timerState: "armed",
        queueDepth: 1,
        activeChildren: 0,
        staleLeases: 0,
        activeJobs: 1,
        pendingApprovalJobs: 0,
        runningRuns: 0,
        enforcement: { toolAndPathPolicy: "active", osSandbox: "disabled" },
      }),
    ).toContain("queue=1");
    expect(
      createStatusView({
        databaseState: "ready",
        timerState: "armed",
        queueDepth: 1,
        activeChildren: 0,
        staleLeases: 0,
        activeJobs: 1,
        pendingApprovalJobs: 0,
        runningRuns: 0,
        enforcement: { toolAndPathPolicy: "active", osSandbox: "disabled" },
      })
        .render(80)
        .join("\n"),
    ).toContain("queue=1");
  });

  it("validates create-dialog values", () => {
    expect(validateCreateDialog({ name: "job", prompt: "run", schedule: {} })).toBe(true);
    expect(validateCreateDialog({ name: " ", prompt: "run", schedule: {} })).toBe(false);
    expect(validateCreateDialog({ name: "job", prompt: " ", schedule: {} })).toBe(false);
    expect(validateCreateDialog({ name: "job", prompt: "run", schedule: undefined })).toBe(false);
  });
});

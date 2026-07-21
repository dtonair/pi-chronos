import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import { renderCompactDashboard } from "../../../src/ui/dashboard-view.js";
import { formatDuration } from "../../../src/ui/format/duration.js";
import { formatPermissions } from "../../../src/ui/format/permissions.js";
import { formatRelativeTime } from "../../../src/ui/format/relative-time.js";
import { formatSchedule } from "../../../src/ui/format/schedule.js";
import { renderJobDetail } from "../../../src/ui/job-detail-view.js";
import { renderJobTable } from "../../../src/ui/jobs-view.js";
import { actionNotification } from "../../../src/ui/notifications.js";
import { formatStatus } from "../../../src/ui/status.js";
import { mapJobToListItem, sortJobItems } from "../../../src/ui/view-models.js";
import { createChronosWorkspaceView } from "../../../src/ui/workspace-view.js";
import { createTestJob } from "../../fixtures/database.js";

const now = Date.parse("2026-07-20T09:00:00.000Z");

function job(
  name: string,
  status: "active" | "paused" | "pending_approval" | "disabled",
  nextRunAt: number | null,
) {
  const value = createTestJob({ status, nextRunAt: nextRunAt as UTCTimestamp | null });
  value.definition.name = name;
  return value;
}

describe("Chronos workspace presentation", () => {
  it("renders structured detail sections without raw JSON or secret values", () => {
    const value = "runtime-secret-value";
    const item = createTestJob({
      id: "detail-job",
      fingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    item.definition.name = "Daily report";
    item.definition.prompt = "A very long prompt ".repeat(30);
    item.definition.execution.environment.secretNames = ["OPENAI_API_KEY"];
    item.definition.execution.environment.values = { OPENAI_API_KEY: value };
    item.definition.permissions.secrets.allowedNames = ["OPENAI_API_KEY"];
    const rendered = renderJobDetail(item, { width: 80, now });

    expect(rendered).not.toContain(JSON.stringify(item, null, 2));
    expect(rendered).toContain("Schedule");
    expect(rendered).toContain("Execution");
    expect(rendered).toContain("Permissions");
    expect(rendered).toContain("Status");
    expect(rendered).toContain("Prompt");
    expect(rendered).toContain("Approval");
    expect(rendered).toContain("OPENAI_API_KEY");
    expect(rendered).not.toContain(value);
    expect(rendered).toContain("012345…abcdef");
    expect(rendered).not.toContain("A very long prompt ".repeat(30));
  });

  it("sorts by operational attention without mutating input", () => {
    const source = [
      mapJobToListItem(job("paused", "paused", null), now),
      mapJobToListItem(job("soon", "active", now + 60_000), now),
      mapJobToListItem(job("approval", "pending_approval", null), now),
      mapJobToListItem(job("disabled", "disabled", null), now),
    ];
    const sorted = sortJobItems(source);
    expect(sorted.map((item) => item.name)).toEqual(["approval", "soon", "paused", "disabled"]);
    expect(source.map((item) => item.name)).toEqual(["paused", "soon", "approval", "disabled"]);
  });

  it("formats time, duration, and schedule unions deterministically", () => {
    expect(formatRelativeTime(now + 38_000, now)).toBe("in 38s");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(formatRelativeTime(0, now)).toContain("ago");
    expect(formatRelativeTime(Number.NaN, now)).toBe("unknown");
    expect(formatDuration(72_000)).toBe("1m 12s");
    expect(formatDuration(2 * 3_600_000 + 4 * 60_000)).toBe("2h 4m");
    expect(formatSchedule({ kind: "once", runAt: "2026-07-21T09:00:00.000Z" }, now)).toContain(
      "once",
    );
    expect(formatSchedule({ kind: "interval", everyMs: 300_000 }, now)).toBe("every 5m");
    expect(formatSchedule({ kind: "cron", expression: "0 9 * * *", timezone: "UTC" }, now)).toBe(
      "cron 0 9 * * *",
    );
  });

  it("keeps table lines bounded at narrow, normal, and wide widths", () => {
    const jobs = [
      job("A very long job name that must be truncated", "active", now + 7_200_000),
      job("backup", "pending_approval", null),
    ];
    for (const width of [48, 80, 120]) {
      const lines = renderJobTable(jobs, { width, now });
      expect(lines.every((line) => [...line].length <= width)).toBe(true);
    }
    expect(renderJobTable([], { width: 48, now })).toEqual(["No Chronos jobs."]);
    expect(renderJobTable(jobs, { width: 80, now }).join("\n")).toContain("NEXT/LAST");
  });

  it("renders healthy and degraded operator status", () => {
    const base = {
      databaseState: "ready" as const,
      timerState: "armed" as const,
      queueDepth: 3,
      activeChildren: 0,
      staleLeases: 0,
      activeJobs: 8,
      pendingApprovalJobs: 2,
      runningRuns: 1,
      enforcement: { toolAndPathPolicy: "active" as const, osSandbox: "disabled" as const },
    };
    expect(formatStatus(base)).toContain("CHRONOS ● ACTIVE");
    expect(formatStatus(base)).toContain("Queue 3");
    expect(formatStatus({ ...base, timerState: "stopped", staleLeases: 2 })).toContain("DEGRADED");
    expect(formatStatus({ ...base, timerState: "stopped", staleLeases: 2 })).toContain(
      "Stale leases 2",
    );
  });

  it("maps actions to specific notifications", () => {
    const target = job("Daily report", "active", null);
    expect(actionNotification("list", { jobs: [target] })).toBe("Loaded 1 Chronos jobs");
    expect(actionNotification("pause", target)).toBe("Paused “Daily report”");
    expect(actionNotification("run_now", target)).toBe("Queued manual run for “Daily report”");
    expect(actionNotification("cancel_run", { id: "run-1", jobId: target.id })).toBe(
      "Run cancellation requested",
    );
    expect(actionNotification("approve", target)).toBe("Approved “Daily report”");
    expect(
      actionNotification("import", { created: 2, unchanged: 1, updated: 1, disabled: 0 }),
    ).toContain("require review");
  });

  it("covers compact dashboard priorities and permission capability labels", () => {
    const active = mapJobToListItem(job("Active", "active", now + 60_000), now);
    const approval = mapJobToListItem(job("Needs approval", "pending_approval", null), now);
    const dashboard = renderCompactDashboard(
      { jobs: [active, approval], hasMoreJobs: true },
      { width: 48, now, maxJobs: 1 },
    );
    expect(dashboard).toContain("Needs approval");
    expect(dashboard).toContain("more jobs");
    expect(
      formatPermissions({
        tools: ["read"],
        shell: { allowed: true, commands: ["echo hello"] },
        filesystem: { readPaths: ["./data"], writePaths: ["./reports"] },
        network: { allowed: true, domains: ["api.example.com"] },
        extensions: { allowedIds: ["ext-a"] },
        secrets: { allowedNames: ["TOKEN"] },
        process: { allowed: false, commands: [] },
      })
        .map((row) => `${row.label} ${row.value}`)
        .join("\n"),
    ).toContain("Shell echo hello");
  });

  it("uses the same Text workspace adapter for compact and expanded modes", () => {
    const state = {
      mode: "jobs" as const,
      jobs: [mapJobToListItem(job("Dashboard job", "active", now + 60_000), now)],
      runs: [],
      approvalLines: [],
    };
    const view = createChronosWorkspaceView(state);
    expect(view.render(48).join("\n")).toContain("Dashboard job");
    expect(view.render(48).every((line) => [...line].length <= 48)).toBe(true);
    const health = {
      databaseState: "ready" as const,
      timerState: "armed" as const,
      queueDepth: 0,
      activeChildren: 0,
      staleLeases: 0,
      activeJobs: 1,
      pendingApprovalJobs: 0,
      runningRuns: 0,
      enforcement: { toolAndPathPolicy: "active" as const, osSandbox: "disabled" as const },
    };
    const detail = mapJobToListItem(job("Dashboard job", "active", null), now);
    for (const mode of ["compact", "health", "job-detail", "history", "approval"] as const) {
      const modeState = {
        mode,
        health,
        jobs: [detail],
        selectedJob:
          mode === "job-detail"
            ? {
                ...detail,
                prompt: "hello",
                model: "m",
                workingDirectory: "/tmp",
                timeoutMs: 1,
                maxOutputBytes: 1,
                overlapPolicy: "skip",
                missedRunPolicy: "skip",
                sandboxRequired: false,
                scheduleKind: "interval",
                failureCount: 0,
                fingerprint: "a".repeat(64),
                approved: false,
                permissions: job("x", "active", null).definition.permissions,
              }
            : undefined,
        runs: [],
        approvalLines: ["safe diff"],
      };
      expect(createChronosWorkspaceView(modeState).render(80).join("\n")).toBeTruthy();
    }
  });
});

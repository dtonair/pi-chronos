import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SchedulerHealth } from "../api/result.js";
import { SchedulerToolInputSchema } from "../api/schemas.js";
import { loadGlobalConfig } from "../config/load.js";
import { chronosConfigPath, chronosDataDir, chronosDbPath } from "../config/paths.js";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Job } from "../domain/job.js";
import type { Run } from "../domain/run.js";
import type { ImportDiff } from "../security/import-diff.js";
import { formatApprovalDiff } from "../ui/approval-dialog.js";
import {
  buildNaturalChronosPrompt,
  isNaturalChronosRequest,
  parseChronosCommand,
} from "../ui/commands.js";
import { actionNotification } from "../ui/notifications.js";
import {
  type ChronosWorkspaceState,
  createInitialWorkspaceState,
  mapJobToDetail,
  mapJobToListItem,
  mapRunToHistoryItem,
} from "../ui/view-models.js";
import { createChronosWorkspaceView } from "../ui/workspace-view.js";
import { type ChronosRuntime, createChronosRuntime } from "./runtime.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJob(value: unknown): value is Job {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isRecord(value.definition) &&
    typeof value.definition.name === "string" &&
    typeof value.status === "string" &&
    typeof value.fingerprint === "string"
  );
}

function isRun(value: unknown): value is Run {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.jobId === "string" &&
    typeof value.status === "string" &&
    typeof value.occurrenceAt === "number" &&
    isRecord(value.timing)
  );
}

function isHealth(value: unknown): value is SchedulerHealth {
  return (
    isRecord(value) &&
    (value.databaseState === "closed" ||
      value.databaseState === "ready" ||
      value.databaseState === "failed") &&
    (value.timerState === "stopped" ||
      value.timerState === "armed" ||
      value.timerState === "waking") &&
    typeof value.queueDepth === "number" &&
    typeof value.activeChildren === "number" &&
    typeof value.staleLeases === "number" &&
    typeof value.activeJobs === "number" &&
    typeof value.pendingApprovalJobs === "number" &&
    typeof value.runningRuns === "number" &&
    isRecord(value.enforcement)
  );
}

function isJobListData(value: unknown): value is { jobs: Job[]; nextCursor?: string } {
  return isRecord(value) && Array.isArray(value.jobs) && value.jobs.every(isJob);
}

function isRunHistoryData(value: unknown): value is { runs: Run[]; nextCursor?: string } {
  return isRecord(value) && Array.isArray(value.runs) && value.runs.every(isRun);
}

function isImportDiff(value: unknown): value is ImportDiff {
  return isRecord(value) && typeof value.field === "string" && typeof value.sensitive === "boolean";
}

function importDiffLines(value: unknown): string[] {
  if (!isRecord(value) || !isRecord(value.diffs)) return [];
  const diffs = Object.values(value.diffs).flatMap((entry) =>
    Array.isArray(entry) ? entry.filter(isImportDiff) : [],
  );
  return formatApprovalDiff(diffs).split("\n");
}

function loadMigrationSql(): string[] {
  const names = ["001_initial.sql", "002_add_metadata_index.sql"];
  const roots = [
    new URL("../storage/schema/", import.meta.url),
    new URL("../../src/storage/schema/", import.meta.url),
  ];
  const migrations: string[] = [];
  for (const name of names) {
    for (const root of roots) {
      try {
        migrations.push(readFileSync(new URL(name, root), "utf8"));
        break;
      } catch {
        /* try the source fallback when running from an unbundled tree */
      }
    }
  }
  return migrations;
}

/** Pi boundary: registration is static; durable resources begin at session_start. */
export default function chronosExtension(pi: ExtensionAPI): void {
  // Keep the public factory side-effect free and tolerant of minimal host fakes.
  if (typeof pi.registerTool !== "function") return;
  let runtime: ChronosRuntime | undefined;
  let workspaceState: ChronosWorkspaceState = createInitialWorkspaceState();

  function installWorkspace(ctx: {
    ui: {
      setWidget: (
        name: string,
        factory: () => Text,
        options?: { placement: "aboveEditor" | "belowEditor" },
      ) => void;
    };
  }): void {
    ctx.ui.setWidget("chronos", () => createChronosWorkspaceView(workspaceState), {
      placement: "aboveEditor",
    });
  }

  function updateWorkspace(
    ctx: {
      ui: {
        setWidget: (
          name: string,
          factory: () => Text,
          options?: { placement: "aboveEditor" | "belowEditor" },
        ) => void;
      };
    },
    patch: Partial<ChronosWorkspaceState>,
  ): void {
    workspaceState = { ...workspaceState, ...patch };
    installWorkspace(ctx);
  }

  pi.registerTool({
    name: "scheduler",
    label: "Scheduler",
    description:
      "Create, inspect, preview, approve, and control durable Chronos scheduled agent jobs.",
    promptSnippet: "Manage durable scheduled agent jobs with the scheduler tool",
    promptGuidelines: [
      "Use scheduler for scheduled jobs; never treat a prompt as implicit execution approval.",
      "Use scheduler.preview before creating a complex schedule.",
    ],
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", `scheduler ${String((args as { action?: unknown }).action ?? "")}`),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => (item.type === "text" ? item.text : ""))
        .join(" ");
      return new Text(theme.fg(context.isError ? "error" : "success", text), 0, 0);
    },
    parameters: SchedulerToolInputSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!runtime) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error: {
                  code: ChronosErrorCode.SCHEDULER_STOPPED,
                  message: "Chronos is not started",
                },
              }),
            },
          ],
          details: {},
        };
      }
      let prepared: unknown = params;
      if (
        ctx.hasUI &&
        typeof params === "object" &&
        params !== null &&
        (params as { action?: unknown }).action !== undefined &&
        ["approve", "revoke_approval"].includes(String((params as { action: unknown }).action)) &&
        !(params as { confirmationToken?: unknown }).confirmationToken
      ) {
        const confirmed = await ctx.ui.confirm(
          "Confirm Chronos approval change",
          "Review the current fingerprint and explicitly confirm this action.",
        );
        if (!confirmed) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  error: { code: "PERMISSION_DENIED", message: "Approval was not confirmed" },
                }),
              },
            ],
            details: {},
          };
        }
        prepared = { ...(params as Record<string, unknown>), confirmationToken: randomUUID() };
      }
      const result = await runtime.router.route(prepared, "pi-user", ctx.mode, {
        cwd: ctx.cwd,
        trustedProject: ctx.isProjectTrusted(),
        source: "tool",
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });

  pi.registerCommand("chronos", {
    description: "Manage Chronos jobs with a scheduler action or command",
    getArgumentCompletions: (prefix: string) => {
      const commands = [
        "status",
        "list",
        "show",
        "create",
        "history",
        "pause",
        "resume",
        "run",
        "cancel",
        "approve",
        "revoke",
        "import",
      ];
      const matches = commands
        .filter((command) => command.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return matches.length === 0 ? null : matches;
    },
    handler: async (args, ctx) => {
      if (!runtime) {
        ctx.ui.notify("Chronos is not started", "error");
        return;
      }
      const value = parseChronosCommand(args);
      if (value === undefined) {
        if (isNaturalChronosRequest(args)) {
          pi.sendUserMessage(buildNaturalChronosPrompt(args));
          ctx.ui.notify("Scheduling request sent to Pi for interpretation", "info");
          return;
        }
        ctx.ui.notify("Unknown /chronos command or malformed JSON", "error");
        return;
      }
      let prepared: unknown = value;
      if (
        ctx.mode === "tui" &&
        typeof value === "object" &&
        value !== null &&
        (value as { action?: unknown }).action === "create" &&
        ((value as { name?: unknown }).name === undefined ||
          (value as { prompt?: unknown }).prompt === undefined ||
          (value as { schedule?: unknown }).schedule === undefined)
      ) {
        const name = await ctx.ui.input("Job name:");
        const prompt = await ctx.ui.editor("Scheduled prompt:");
        const scheduleText = await ctx.ui.input(
          "Schedule JSON (for example: an interval schedule):",
        );
        if (!name || !prompt || !scheduleText) {
          ctx.ui.notify("Job creation cancelled", "warning");
          return;
        }
        try {
          const schedule = JSON.parse(scheduleText) as unknown;
          prepared = {
            ...(value as Record<string, unknown>),
            name,
            prompt,
            schedule,
          };
        } catch {
          ctx.ui.notify("Schedule must be valid JSON", "error");
          return;
        }
      }
      if (
        ctx.hasUI &&
        typeof prepared === "object" &&
        prepared !== null &&
        ["approve", "revoke_approval"].includes(
          String((prepared as { action?: unknown }).action),
        ) &&
        !(prepared as { confirmationToken?: unknown }).confirmationToken
      ) {
        const confirmed = await ctx.ui.confirm(
          "Confirm Chronos approval change",
          "Review the current fingerprint and explicitly confirm this action.",
        );
        if (!confirmed) {
          ctx.ui.notify("Approval was not confirmed", "warning");
          return;
        }
        prepared = {
          ...(prepared as Record<string, unknown>),
          confirmationToken: randomUUID(),
        };
      }
      const result = await runtime.router.route(prepared, "pi-user", ctx.mode, {
        cwd: ctx.cwd,
        trustedProject: ctx.isProjectTrusted(),
        source: "direct_user",
      });
      const action =
        isRecord(prepared) && typeof prepared.action === "string" ? prepared.action : "unknown";
      if (ctx.mode === "tui" && typeof ctx.ui.setWidget === "function") {
        if (!result.ok) {
          // Keep the previous useful workspace visible while surfacing the
          // recoverable command error in both the widget and notification.
          updateWorkspace(ctx, {
            notification: { message: result.error.message, severity: "error" },
          });
        } else {
          const data = result.data;
          const now = Date.now();
          if (action === "list" && isJobListData(data)) {
            updateWorkspace(ctx, {
              mode: "jobs",
              jobs: data.jobs.map((job) => mapJobToListItem(job, now)),
              hasMoreJobs: data.nextCursor !== undefined,
              lastUpdatedAt: now,
              notification: { message: actionNotification(action, data), severity: "info" },
            });
          } else if (action === "get" && isJob(data)) {
            updateWorkspace(ctx, {
              mode: "job-detail",
              selectedJob: mapJobToDetail(data, now),
              lastUpdatedAt: now,
              notification: { message: actionNotification(action, data), severity: "info" },
            });
          } else if (action === "history" && isRunHistoryData(data)) {
            updateWorkspace(ctx, {
              mode: "history",
              runs: data.runs.map(mapRunToHistoryItem),
              lastUpdatedAt: now,
              notification: { message: actionNotification(action), severity: "info" },
            });
          } else if (action === "health" && isHealth(data)) {
            updateWorkspace(ctx, {
              mode: "health",
              health: data,
              lastUpdatedAt: now,
              notification: { message: actionNotification(action), severity: "info" },
            });
          } else if (action === "import") {
            updateWorkspace(ctx, {
              mode: "approval",
              approvalLines: importDiffLines(data),
              lastUpdatedAt: now,
              notification: { message: actionNotification(action, data), severity: "info" },
            });
          } else if (isJob(data)) {
            const item = mapJobToListItem(data, now);
            updateWorkspace(ctx, {
              jobs: workspaceState.jobs.map((existing) =>
                existing.id === item.id ? item : existing,
              ),
              selectedJob:
                workspaceState.selectedJob?.id === item.id
                  ? mapJobToDetail(data, now)
                  : workspaceState.selectedJob,
              lastUpdatedAt: now,
              notification: { message: actionNotification(action, data), severity: "info" },
            });
          } else {
            updateWorkspace(ctx, {
              notification: { message: actionNotification(action, data), severity: "info" },
            });
          }
        }
      }
      ctx.ui.notify(
        result.ok ? actionNotification(action, result.data) : result.error.message,
        result.ok ? "info" : "error",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    // A reload or session replacement is terminal for the previous runtime.
    // Stop it before composing the replacement so only one DB/timer/instance
    // set can remain live for this extension instance.
    await runtime?.stop();
    runtime = undefined;
    let candidate: ChronosRuntime | undefined;
    try {
      const dataDir = chronosDataDir(getAgentDir());
      const config = loadGlobalConfig(chronosConfigPath(dataDir));
      candidate = createChronosRuntime({
        databasePath: chronosDbPath(dataDir),
        config,
        migrationSql: loadMigrationSql(),
        configDirName: CONFIG_DIR_NAME,
        model: ctx.model === undefined ? undefined : `${ctx.model.provider}/${ctx.model.id}`,
      });
      candidate.start();
      runtime = candidate;
      if (ctx.hasUI) {
        workspaceState = createInitialWorkspaceState();
        // Hydrate the compact dashboard from authoritative router responses,
        // then install the single stable workspace widget.
        const [healthResult, listResult] = await Promise.all([
          candidate.router.route({ action: "health" }, "pi-user", "tui"),
          candidate.router.route({ action: "list", scope: "user" }, "pi-user", "tui"),
        ]);
        const health =
          healthResult.ok && isHealth(healthResult.data) ? healthResult.data : undefined;
        const jobs = listResult.ok && isJobListData(listResult.data) ? listResult.data.jobs : [];
        workspaceState = {
          ...workspaceState,
          mode: "compact",
          health,
          jobs: jobs.map((job) => mapJobToListItem(job)),
          hasMoreJobs:
            listResult.ok && isJobListData(listResult.data)
              ? listResult.data.nextCursor !== undefined
              : undefined,
          lastUpdatedAt: Date.now(),
        };
        installWorkspace(ctx);
      }
    } catch (error) {
      await candidate?.stop();
      runtime = undefined;
      if (ctx.hasUI)
        ctx.ui.notify(
          error instanceof ChronosError ? error.message : "Chronos failed to start",
          "error",
        );
    }
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    await runtime?.stop();
    runtime = undefined;
  });

  // CONFIG_DIR_NAME is intentionally referenced at this boundary so project
  // import adapters use Pi's configured project directory name, not `.pi`.
  void join(CONFIG_DIR_NAME, "chronos.json");
}

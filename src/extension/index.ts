import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SchedulerToolInputSchema } from "../api/schemas.js";
import { loadGlobalConfig } from "../config/load.js";
import { chronosConfigPath, chronosDataDir, chronosDbPath } from "../config/paths.js";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import { createApprovalDiffView } from "../ui/approval-dialog.js";
import {
  buildNaturalChronosPrompt,
  isNaturalChronosRequest,
  parseChronosCommand,
} from "../ui/commands.js";
import { createJobDetailView } from "../ui/job-detail-view.js";
import { createJobsView } from "../ui/jobs-view.js";
import { createRunHistoryView } from "../ui/run-history-view.js";
import { createStatusView } from "../ui/status.js";
import { type ChronosRuntime, createChronosRuntime } from "./runtime.js";

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
      if (ctx.mode === "tui") {
        if (!result.ok) {
          ctx.ui.setWidget("chronos", undefined);
        } else {
          const action = (prepared as { action?: string }).action;
          const data = result.data as Record<string, unknown>;
          if (action === "list" && Array.isArray(data.jobs)) {
            ctx.ui.setWidget("chronos", () => createJobsView(data.jobs as never[]), {
              placement: "aboveEditor",
            });
          } else if (action === "get") {
            ctx.ui.setWidget("chronos", () => createJobDetailView(data as never), {
              placement: "aboveEditor",
            });
          } else if (action === "history" && Array.isArray(data.runs)) {
            ctx.ui.setWidget("chronos", () => createRunHistoryView(data.runs as never[]), {
              placement: "aboveEditor",
            });
          } else if (action === "health") {
            ctx.ui.setWidget("chronos", () => createStatusView(data as never), {
              placement: "aboveEditor",
            });
          } else if (action === "import" && data.diffs && typeof data.diffs === "object") {
            const diffs = Object.values(data.diffs as Record<string, unknown>).flat();
            ctx.ui.setWidget("chronos", () => createApprovalDiffView(diffs as never[]), {
              placement: "aboveEditor",
            });
          }
        }
      }
      ctx.ui.notify(
        result.ok ? "Chronos action completed" : result.error.message,
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
      if (ctx.hasUI) ctx.ui.setStatus("chronos", "Chronos: active");
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

  pi.on("session_shutdown", async (_event, ctx) => {
    await runtime?.stop();
    runtime = undefined;
    if (ctx.hasUI) ctx.ui.setStatus("chronos", undefined);
  });

  // CONFIG_DIR_NAME is intentionally referenced at this boundary so project
  // import adapters use Pi's configured project directory name, not `.pi`.
  void join(CONFIG_DIR_NAME, "chronos.json");
}

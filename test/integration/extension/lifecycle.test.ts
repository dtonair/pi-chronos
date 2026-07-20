import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import chronosExtension from "../../../src/extension/index.js";
import { createLifecycle } from "../../../src/extension/lifecycle.js";

describe("extension lifecycle", () => {
  it("starts and replaces a real composed runtime without leaking the old session", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "chronos-agent-"));
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const handlers = new Map<string, (event: unknown, context: unknown) => Promise<void>>();
      const notices: string[] = [];
      let widgets = 0;
      let inputCount = 0;
      let commandHandler: ((args: string, context: unknown) => Promise<void>) | undefined;
      let toolExecute: ((...args: readonly unknown[]) => Promise<unknown>) | undefined;
      const sentUserMessages: string[] = [];
      const pi = {
        registerTool: (definition: {
          execute: (...args: readonly unknown[]) => Promise<unknown>;
        }) => {
          toolExecute = definition.execute;
        },
        registerCommand: (
          _name: string,
          definition: { handler: (args: string, context: unknown) => Promise<void> },
        ) => {
          commandHandler = definition.handler;
        },
        on: (event: string, handler: (event: unknown, context: unknown) => Promise<void>) => {
          handlers.set(event, handler);
        },
        sendUserMessage: (message: string) => sentUserMessages.push(message),
      };
      chronosExtension(pi as never);
      const context = {
        model: { provider: "test", id: "model" },
        mode: "tui",
        hasUI: true,
        cwd: agentDir,
        isProjectTrusted: () => false,
        ui: {
          input: async () =>
            inputCount++ === 0 ? "TUI job" : '{"kind":"interval","everyMs":60000}',
          editor: async () => "Do the TUI work",
          confirm: async () => true,
          notify: (message: string) => notices.push(message),
          setStatus: () => undefined,
          setWidget: () => {
            widgets += 1;
          },
        },
      };
      await handlers.get("session_start")?.({}, context);
      expect(commandHandler).toBeDefined();
      await commandHandler?.("create", context);
      expect(notices.length).toBeGreaterThan(0);
      await commandHandler?.("status", context);
      expect(widgets).toBe(1);
      await commandHandler?.(
        "create PR to develop and check bitbucket pipeline status every 5 minutes and write it to ./pipeline-status.md",
        context,
      );
      expect(sentUserMessages).toHaveLength(1);
      expect(sentUserMessages[0]).toContain("using the scheduler tool");
      expect(toolExecute).toBeDefined();
      const createdByTool = await toolExecute?.(
        "tool-call",
        {
          action: "create",
          name: "Tool approval job",
          prompt: "Run the approved tool job",
          schedule: { kind: "interval", everyMs: 60_000 },
        },
        new AbortController().signal,
        () => undefined,
        context,
      );
      const createdDetails = (
        createdByTool as { details?: { ok: boolean; data?: Record<string, unknown> } }
      ).details;
      expect(createdDetails?.ok).toBe(true);
      const toolJob = createdDetails?.data;
      const approvedByTool = await toolExecute?.(
        "tool-approval",
        {
          action: "approve",
          jobId: toolJob?.id,
          fingerprint: toolJob?.fingerprint,
        },
        new AbortController().signal,
        () => undefined,
        context,
      );
      expect((approvedByTool as { details?: { ok: boolean } }).details?.ok).toBe(true);
      await handlers.get("session_start")?.({ reason: "reload" }, context);
      await handlers.get("session_start")?.({ reason: "new" }, context);
      await handlers.get("session_start")?.({ reason: "resume" }, context);
      await handlers.get("session_start")?.({ reason: "fork" }, context);
      await handlers.get("session_shutdown")?.({}, context);
      await handlers.get("session_shutdown")?.({}, context);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("reports partial startup failures through the UI without throwing", async () => {
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = "/dev/null";
    const notices: string[] = [];
    const handlers = new Map<string, (event: unknown, context: unknown) => Promise<void>>();
    const pi = {
      registerTool: () => undefined,
      registerCommand: () => undefined,
      on: (event: string, handler: (event: unknown, context: unknown) => Promise<void>) => {
        handlers.set(event, handler);
      },
    };
    try {
      chronosExtension(pi as never);
      await handlers.get("session_start")?.(
        {},
        {
          model: undefined,
          hasUI: true,
          cwd: "/tmp",
          isProjectTrusted: () => false,
          ui: { notify: (message: string) => notices.push(message) },
        },
      );
      expect(notices.length).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it("starts and stops resources exactly once and reverses shutdown order", async () => {
    const calls: string[] = [];
    const lifecycle = createLifecycle(
      ["db", "scheduler"].map((name) => ({
        start: () => {
          calls.push(`start:${name}`);
        },
        stop: () => {
          calls.push(`stop:${name}`);
        },
      })),
    );
    await lifecycle.start();
    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.stop();
    expect(calls).toEqual(["start:db", "start:scheduler", "stop:scheduler", "stop:db"]);
  });

  it("coalesces concurrent startup and still cleans up after a failed resource", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lifecycle = createLifecycle([
      {
        start: async () => {
          calls.push("start:first");
          await gate;
        },
        stop: () => {
          calls.push("stop:first");
        },
      },
      {
        start: async () => {
          calls.push("start:second");
          throw new Error("startup failed");
        },
        stop: () => {
          calls.push("stop:second");
        },
      },
    ]);
    const first = lifecycle.start();
    const second = lifecycle.start();
    release();
    await expect(first).rejects.toThrow("startup failed");
    await expect(second).rejects.toThrow("startup failed");
    expect(calls).toEqual(["start:first", "start:second", "stop:second", "stop:first"]);
    expect(lifecycle.started).toBe(false);
  });

  it("continues reverse shutdown when one resource fails", async () => {
    const calls: string[] = [];
    const lifecycle = createLifecycle([
      {
        start: () => undefined,
        stop: () => {
          calls.push("stop:first");
        },
      },
      {
        start: () => undefined,
        stop: () => {
          calls.push("stop:second");
          throw new Error("stop failed");
        },
      },
      {
        start: () => undefined,
        stop: () => {
          calls.push("stop:third");
        },
      },
    ]);
    await lifecycle.start();
    await expect(lifecycle.stop()).rejects.toThrow("stop failed");
    expect(calls).toEqual(["stop:third", "stop:second", "stop:first"]);
    expect(lifecycle.started).toBe(false);
    await lifecycle.stop();
  });
});

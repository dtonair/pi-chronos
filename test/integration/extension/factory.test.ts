import { describe, expect, it } from "vitest";
import chronosExtension from "../../../src/extension/index.js";

describe("Pi extension boundary", () => {
  it("registers static metadata without starting durable resources", () => {
    const tools: Array<{ name: string }> = [];
    const commands: string[] = [];
    const handlers = new Map<string, unknown>();
    const pi = {
      registerTool(definition: { name: string }) {
        tools.push(definition);
      },
      registerCommand(name: string) {
        commands.push(name);
      },
      on(event: string, handler: unknown) {
        handlers.set(event, handler);
      },
    };

    chronosExtension(pi as never);
    expect(tools.map((tool) => tool.name)).toEqual(["scheduler"]);
    expect(commands).toEqual(["chronos"]);
    expect(handlers.has("session_start")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
  });

  it("exposes documented completions, renderers, and stopped-runtime results", async () => {
    let tool: Record<string, (...args: unknown[]) => unknown> | undefined;
    let command: Record<string, (...args: unknown[]) => unknown> | undefined;
    const notices: string[] = [];
    const pi = {
      registerTool(definition: Record<string, (...args: unknown[]) => unknown>) {
        tool = definition;
      },
      registerCommand(_name: string, definition: Record<string, (...args: unknown[]) => unknown>) {
        command = definition;
      },
      on: () => undefined,
    };
    chronosExtension(pi as never);
    expect(command?.getArgumentCompletions?.("st")).toEqual([{ value: "status", label: "status" }]);
    expect(command?.getArgumentCompletions?.("unknown")).toBeNull();
    const theme = { fg: (_name: string, text: string) => text };
    expect(tool?.renderCall?.({ action: "health" }, theme)).toBeDefined();
    expect(
      tool?.renderResult?.({ content: [{ type: "text", text: "ok" }] }, {}, theme, {
        isError: false,
      }),
    ).toBeDefined();
    const result = await tool?.execute?.(
      "id",
      { action: "health" },
      new AbortController().signal,
      undefined,
      {
        hasUI: false,
        mode: "json",
        cwd: "/tmp",
      },
    );
    expect(result).toBeDefined();
    await command?.handler?.("status", {
      ui: { notify: (message: string) => notices.push(message) },
    });
    expect(notices).toContain("Chronos is not started");
  });
});

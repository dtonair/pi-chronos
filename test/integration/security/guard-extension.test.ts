import { afterEach, describe, expect, it } from "vitest";
import runnerGuardExtension from "../../../src/execution/guard-extension.js";

describe("trusted child guard extension", () => {
  afterEach(() => {
    delete process.env.CHRONOS_POLICY_MANIFEST;
    delete process.env.CHRONOS_RUN_ID;
    delete process.env.CHRONOS_JOB_ID;
    delete process.env.CHRONOS_OWNER_ID;
    delete process.env.CHRONOS_FINGERPRINT;
  });

  it("removes scheduler and blocks tools when the manifest is unavailable", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    let activeTools = ["scheduler", "read"];
    const pi = {
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
      getActiveTools: () => activeTools,
      setActiveTools: (tools: string[]) => {
        activeTools = tools;
      },
    };
    runnerGuardExtension(pi as never);
    await handlers.get("session_start")?.({}, {});
    expect(activeTools).toEqual(["read"]);
    const result = await handlers.get("tool_call")?.({ toolName: "read", input: { path: "x" } });
    expect(result).toEqual({ block: true, reason: "Chronos policy manifest unavailable" });
    await handlers.get("session_shutdown")?.();
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import runnerGuardExtension from "../../../src/execution/guard-extension.js";

describe("trusted child guard extension", () => {
  const directories: string[] = [];

  afterEach(() => {
    delete process.env.CHRONOS_POLICY_MANIFEST;
    delete process.env.CHRONOS_RUN_ID;
    delete process.env.CHRONOS_JOB_ID;
    delete process.env.CHRONOS_OWNER_ID;
    delete process.env.CHRONOS_FINGERPRINT;
    delete process.env.CHRONOS_SEATBELT_PROFILE;
    delete process.env.CHRONOS_SANDBOX_REQUIRED;
    delete process.env.CHRONOS_PERMISSION_MODE;
    delete process.env.PI_SEATBELT_PROFILE;
    delete process.env.PI_SEATBELT_PROFILE_SCOPE;
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("captures and removes the internal sandbox profile before tools run", async () => {
    process.env.CHRONOS_SEATBELT_PROFILE = "/tmp/run.sb";
    process.env.CHRONOS_SANDBOX_REQUIRED = "1";
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const pi = {
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
      getActiveTools: () => ["scheduler", "read"],
      setActiveTools: () => undefined,
    };
    runnerGuardExtension(pi as never);
    await handlers.get("session_start")?.({}, {});
    expect(process.env.CHRONOS_SEATBELT_PROFILE).toBeUndefined();
    expect(process.env.CHRONOS_SANDBOX_REQUIRED).toBeUndefined();
    await handlers.get("session_shutdown")?.();
  });

  it("accepts a valid delegated profile and leaves pi-seatbelt's Bash override active", async () => {
    const directory = mkdtempSync(join(tmpdir(), "chronos-delegated-profile-"));
    directories.push(directory);
    const profile = join(directory, "seatbelt.sb");
    writeFileSync(profile, "(version 1) (deny default)", { mode: 0o600 });
    process.env.CHRONOS_PERMISSION_MODE = "pi-seatbelt-sandbox";
    process.env.PI_SEATBELT_PROFILE = profile;
    process.env.PI_SEATBELT_PROFILE_SCOPE = "tool-subprocess-v1";
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const registered: string[] = [];
    const pi = {
      registerTool(tool: { name: string }) {
        registered.push(tool.name);
      },
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(event, handler);
      },
      getActiveTools: () => ["scheduler", "read", "bash"],
      setActiveTools: () => undefined,
    };
    runnerGuardExtension(pi as never);
    expect(registered).toEqual(["chronos_exec", "chronos_atomic_write", "chronos_complete"]);
    await handlers.get("session_start")?.({}, {});
    expect(process.env.PI_SEATBELT_PROFILE).toBeUndefined();
    expect(process.env.PI_SEATBELT_PROFILE_SCOPE).toBeUndefined();
    await handlers.get("session_shutdown")?.();
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

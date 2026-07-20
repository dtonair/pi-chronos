import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import type { PolicyManifest } from "../../../src/domain/permission.js";
import { createRunnerGuard } from "../../../src/execution/runner-guard.js";

const manifest: PolicyManifest = {
  schemaVersion: 1,
  nonce: "nonce-1234567890",
  runId: "run-1",
  jobId: "job-1",
  ownerId: "owner-1",
  fingerprint: "a".repeat(64),
  issuedAt: 1_000 as UTCTimestamp,
  expiresAt: 10_000 as UTCTimestamp,
  permissions: {
    tools: ["read"],
    shell: { allowed: false, commands: [] },
    filesystem: { readPaths: ["/tmp/job"], writePaths: [] },
    network: { allowed: false, domains: [] },
    extensions: { allowedIds: [] },
    secrets: { allowedNames: [] },
    canonicalReadPaths: ["/tmp/job"],
    canonicalWritePaths: [],
  },
};

describe("trusted runner guard", () => {
  it("blocks before session start and after shutdown", async () => {
    const guard = createRunnerGuard(manifest, "/tmp/job");
    expect((await guard.authorize({ tool: "read", input: { path: "file.txt" } })).ok).toBe(false);
    expect(guard.sessionStart(1_000).ok).toBe(true);
    expect((await guard.authorize({ tool: "scheduler", input: {} })).ok).toBe(false);
    guard.sessionShutdown();
    expect((await guard.authorize({ tool: "read", input: { path: "file.txt" } })).ok).toBe(false);
  });

  it("checks every supported built-in tool through the same policy", async () => {
    const allTools = ["read", "grep", "find", "ls", "edit", "write", "bash"] as const;
    const allToolsManifest = {
      ...manifest,
      permissions: {
        ...manifest.permissions,
        tools: [...allTools],
        shell: { allowed: true, commands: ["echo ok"] },
        filesystem: { readPaths: ["/tmp/job"], writePaths: ["/tmp/job"] },
        canonicalReadPaths: ["/tmp/job"],
        canonicalWritePaths: ["/tmp/job"],
      },
    };
    const guard = createRunnerGuard(allToolsManifest, "/tmp/job");
    expect(guard.sessionStart(2_000).ok).toBe(true);
    const calls = [
      { tool: "read", input: { path: "file.txt" } },
      { tool: "grep", input: { path: "file.txt", pattern: "x" } },
      { tool: "find", input: { path: "." } },
      { tool: "ls", input: { path: "." } },
      { tool: "edit", input: { filePath: "file.txt" } },
      { tool: "write", input: { path: "file.txt", content: "x" } },
      { tool: "bash", input: { command: "echo ok" } },
    ] as const;
    for (const call of calls) expect((await guard.authorize(call)).ok).toBe(true);
  });

  it("delegates tool, shell, and filesystem authorization to pi-seatbelt", async () => {
    const guard = createRunnerGuard(manifest, "/tmp/job", undefined, undefined, {
      profilePath: "/tmp/seatbelt.sb",
      sandboxRequired: true,
      delegateToPiSeatbelt: true,
    });
    expect(guard.sessionStart(2_000).ok).toBe(true);
    expect((await guard.authorize({ tool: "read", input: { path: "/outside/job" } })).ok).toBe(
      true,
    );
    expect((await guard.authorize({ tool: "bash", input: { command: "anything" } })).ok).toBe(true);
    expect((await guard.authorize({ tool: "extension_tool", input: {} })).ok).toBe(true);
    expect((await guard.authorize({ tool: "scheduler", input: {} })).ok).toBe(false);
  });

  it("authorizes declared paths and rejects unknown tools and escapes", async () => {
    const guard = createRunnerGuard(manifest, "/tmp/job");
    expect(guard.sessionStart(2_000).ok).toBe(true);
    expect((await guard.authorize({ tool: "read", input: { path: "file.txt" } })).ok).toBe(true);
    expect((await guard.authorize({ tool: "read", input: { path: "../secret" } })).ok).toBe(false);
    expect((await guard.authorize({ tool: "unknown", input: {} })).ok).toBe(false);
    expect(guard.tools([{ name: "scheduler" }, { name: "read" }]).map((tool) => tool.name)).toEqual(
      ["read"],
    );
  });
});

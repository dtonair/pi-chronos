import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWrite } from "../../src/execution/atomic-write.js";
import { reduceTerminalOutcome } from "../../src/execution/outcome.js";
import { executeStructuredProcess } from "../../src/execution/structured-process-tool.js";
import { authorizeStructuredProcess } from "../../src/security/process-policy.js";

describe("Bitbucket monitor host-neutral acceptance", () => {
  it("lists, resolves a typed UUID, and atomically replaces the approved report", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "chronos-bitbucket-"));
    const cli = join(workspace, "bitbucket-cli");
    const config = join(workspace, "fixture-config");
    await writeFile(config, "fixture-token", { mode: 0o600 });
    await writeFile(
      cli,
      '#!/bin/sh\ncat "$FAKE_CONFIG" >/dev/null || exit 3\nif [ "$1" = "list" ]; then printf \'[{"uuid":"{123e4567-e89b-12d3-a456-426614174000}"}]\'; exit 0; fi\nif [ "$1" = "get" ] && [ "$2" = "{123e4567-e89b-12d3-a456-426614174000}" ]; then printf \'{"state":"COMPLETED"}\'; exit 0; fi\nexit 2\n',
      { mode: 0o700 },
    );
    await chmod(cli, 0o700);
    const permissions = {
      tools: ["chronos_exec", "chronos_atomic_write"],
      shell: { allowed: false, commands: [] },
      filesystem: { readPaths: [workspace], writePaths: [workspace] },
      network: { allowed: false, domains: [] },
      extensions: { allowedIds: [] },
      secrets: { allowedNames: [] },
      process: {
        allowed: true,
        commands: [
          { executable: "bitbucket-cli", args: [{ kind: "literal" as const, value: "list" }] },
          {
            executable: "bitbucket-cli",
            args: [
              { kind: "literal" as const, value: "get" },
              { kind: "slot" as const, name: "runtime", valueType: "uuid" as const },
            ],
          },
        ],
      },
    };
    const listCall = authorizeStructuredProcess(
      { executable: "bitbucket-cli", args: ["list"] },
      permissions.process,
      workspace,
    );
    expect(listCall.ok).toBe(true);
    if (!listCall.ok) return;
    const listed = await executeStructuredProcess(listCall.value, {
      cwd: workspace,
      env: { PATH: `${workspace}${delimiter}${process.env.PATH ?? ""}`, FAKE_CONFIG: config },
      maxOutputBytes: 10_000,
      timeoutMs: 5_000,
    });
    expect(listed.ok && listed.value.stdout).toContain("123e4567");

    const uuid = "{123e4567-e89b-12d3-a456-426614174000}";
    const getCall = authorizeStructuredProcess(
      { executable: "bitbucket-cli", args: ["get", uuid] },
      permissions.process,
      workspace,
    );
    expect(getCall.ok).toBe(true);
    if (!getCall.ok) return;
    const detail = await executeStructuredProcess(getCall.value, {
      cwd: workspace,
      env: { PATH: `${workspace}${delimiter}${process.env.PATH ?? ""}`, FAKE_CONFIG: config },
      maxOutputBytes: 10_000,
      timeoutMs: 5_000,
    });
    expect(detail.ok && detail.value.stdout).toContain("COMPLETED");

    const report = join(workspace, "PIPELINE_STATUS.md");
    const written = await atomicWrite("PIPELINE_STATUS.md", "# COMPLETED\n", {
      cwd: workspace,
      permissions,
    });
    expect(written.ok).toBe(true);
    expect(await readFile(report, "utf8")).toBe("# COMPLETED\n");
    expect(
      reduceTerminalOutcome({
        completion: {
          mode: "explicit",
          requiredOutputs: [{ path: report, mutation: "atomic_replace" }],
        },
        exitCode: 0,
        completionDeclarations: 1,
        completionStatus: "succeeded",
        requiredOutputs: [true],
      }).status,
    ).toBe("succeeded");
    expect(
      authorizeStructuredProcess(
        { executable: "bitbucket-cli", args: ["get", `${uuid};echo`] },
        permissions.process,
        workspace,
      ).ok,
    ).toBe(false);
    const missingConfig = await executeStructuredProcess(listCall.value, {
      cwd: workspace,
      env: {
        PATH: `${workspace}${delimiter}${process.env.PATH ?? ""}`,
        FAKE_CONFIG: join(workspace, "missing"),
      },
      maxOutputBytes: 10_000,
      timeoutMs: 5_000,
    });
    expect(missingConfig.ok && missingConfig.value.exitCode).not.toBe(0);
    expect(
      (await atomicWrite("denied/PIPELINE_STATUS.md", "no", { cwd: workspace, permissions })).ok,
    ).toBe(false);
  });
});

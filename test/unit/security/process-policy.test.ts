import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeStructuredProcess,
  validateSlotValue,
} from "../../../src/security/process-policy.js";

describe("structured process policy", () => {
  it("accepts exact literals and bounded typed slots", () => {
    expect(validateSlotValue("uuid", "{123e4567-e89b-12d3-a456-426614174000}")).toBe(true);
    expect(validateSlotValue("integer", "42")).toBe(true);
    expect(validateSlotValue("slug", "pipeline-1")).toBe(true);
    expect(validateSlotValue("slug", "bad value")).toBe(false);
    expect(validateSlotValue("uuid", "123e4567-e89b-12d3-a456-426614174000;rm")).toBe(false);
    expect(validateSlotValue("integer", "1.2")).toBe(false);
    expect(validateSlotValue("integer", " ")).toBe(false);
  });

  it("resolves the controlled PATH and rejects argv changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "chronos-process-policy-"));
    const executable = join(directory, "fake-cli");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(executable, 0o700);
    const permissions = {
      allowed: true,
      commands: [
        {
          executable: "fake-cli",
          args: [
            { kind: "literal" as const, value: "get" },
            { kind: "slot" as const, name: "id", valueType: "uuid" as const },
          ],
        },
      ],
    };
    const good = authorizeStructuredProcess(
      { executable: "fake-cli", args: ["get", "123e4567-e89b-12d3-a456-426614174000"] },
      permissions,
      directory,
    );
    expect(good.ok).toBe(true);
    const bad = authorizeStructuredProcess(
      { executable: "fake-cli", args: ["get", "123e4567-e89b-12d3-a456-426614174000;echo"] },
      permissions,
      directory,
    );
    expect(bad.ok).toBe(false);
    expect(
      authorizeStructuredProcess({ executable: "fake-cli", args: ["list"] }, permissions, directory)
        .ok,
    ).toBe(false);
    expect(
      authorizeStructuredProcess(
        { executable: "fake-cli", args: ["get", "1", "extra"] },
        permissions,
        directory,
      ).ok,
    ).toBe(false);
    expect(
      authorizeStructuredProcess({ executable: "missing", args: [] }, permissions, directory).ok,
    ).toBe(false);
    expect(
      authorizeStructuredProcess({ executable: "fake-cli", args: [] }, undefined, directory).ok,
    ).toBe(false);
    expect(
      authorizeStructuredProcess({ executable: "fake cli", args: [] }, permissions, directory).ok,
    ).toBe(false);
  });
});

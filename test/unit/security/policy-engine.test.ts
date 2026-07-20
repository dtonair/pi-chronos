import { describe, expect, it } from "vitest";
import { authorizeToolCall } from "../../../src/security/policy-engine.js";
import { checkShellCommand } from "../../../src/security/shell-policy.js";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { DEFAULT_PERMISSIONS } from "../../fixtures/database.js";

const canonicalizer = {
  canonicalize: (path: string) => path,
  exists: async () => true,
  realpath: async (path: string) => path,
};

describe("runner policy", () => {
  it("denies unknown tools and emits a policy event", async () => {
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const unknown = await authorizeToolCall(
      { tool: "scheduler", input: {} },
      { cwd: "/tmp", permissions: DEFAULT_PERMISSIONS, canonicalizer, events },
    );
    expect(unknown.ok).toBe(false);
    expect(seen).toEqual(["policy.denied"]);
    expect(
      checkShellCommand("echo hello && whoami", {
        ...DEFAULT_PERMISSIONS,
        shell: { allowed: true, commands: ["echo hello"] },
      }).ok,
    ).toBe(false);
  });

  it("checks path boundaries rather than string prefixes", async () => {
    const result = await authorizeToolCall(
      { tool: "read", input: { path: "/tmp-other/file" } },
      {
        cwd: "/tmp",
        permissions: {
          ...DEFAULT_PERMISSIONS,
          filesystem: { readPaths: ["/tmp"], writePaths: ["/tmp"] },
        },
        canonicalizer,
      },
    );
    expect(result.ok).toBe(false);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPlatformSandboxAdapter,
  disabledSandbox,
  unavailableSandbox,
} from "../../../src/security/sandbox-adapter.js";

describe("OS sandbox adapter", () => {
  it("fails closed on unsupported platforms", async () => {
    const adapter = createPlatformSandboxAdapter(
      "linux",
      "/missing/sandbox-exec",
      true,
      () => undefined,
    );
    expect(adapter.supported).toBe(false);
    const result = await adapter.initialize({ workingDirectory: "/tmp", readOnly: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SANDBOX_UNAVAILABLE");
  });

  it("wraps executable argv through sandbox-exec without a shell", async () => {
    const adapter = createPlatformSandboxAdapter(
      "darwin",
      "/usr/bin/sandbox-exec",
      false,
      () => undefined,
    );
    expect(adapter.supported).toBe(true);
    const result = await adapter.initialize({
      workingDirectory: "/tmp/job",
      readOnly: false,
      readPaths: ["/tmp/read"],
      writePaths: ["/tmp/write"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const wrapped = result.value.wrapExecutable("/usr/bin/pi", ["--mode", "json"]);
      expect(wrapped.executable).toBe("/usr/bin/sandbox-exec");
      expect(wrapped.args).toContain("/usr/bin/pi");
      expect(wrapped.args).not.toContain("sh");
    }
  });

  it("probes the host adapter and fails closed when sandbox application is unavailable", () => {
    const adapter = createPlatformSandboxAdapter(
      "darwin",
      "/usr/bin/sandbox-exec",
      true,
      () => undefined,
    );
    expect(typeof adapter.supported).toBe("boolean");
  });

  it("reuses a published Seatbelt profile without narrowing its policy", async () => {
    const directory = mkdtempSync(join(tmpdir(), "chronos-seatbelt-profile-"));
    const profile = join(directory, "profile.sb");
    writeFileSync(profile, "(version 1) (allow default)", { mode: 0o600 });
    let published: string | undefined = profile;
    try {
      const adapter = createPlatformSandboxAdapter(
        "darwin",
        "/usr/bin/false",
        true,
        () => published,
      );
      expect(adapter.supported).toBe(true);
      const result = await adapter.initialize({
        workingDirectory: "/private/job",
        readOnly: true,
        readPaths: ["/private/read"],
        writePaths: ["/private/write"],
        networkAllowed: false,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const wrapped = result.value.wrapExecutable("/usr/bin/pi", ["--mode", "json"]);
        expect(wrapped).toEqual({
          executable: "/usr/bin/false",
          args: ["-f", profile, "--", "/usr/bin/pi", "--mode", "json"],
        });
        expect(wrapped.args.join(" ")).not.toContain("/private/job");
      }
      published = undefined;
      expect(adapter.supported).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps unavailable and disabled states distinct", async () => {
    expect(unavailableSandbox.supported).toBe(false);
    expect(disabledSandbox.supported).toBe(false);
    const result = await disabledSandbox.initialize({ workingDirectory: "/tmp", readOnly: true });
    expect(result.ok).toBe(true);
  });
});

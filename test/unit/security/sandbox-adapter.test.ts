import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("probes sandbox application with a permissive policy instead of a process-only false negative", async () => {
    const directory = mkdtempSync(join(tmpdir(), "chronos-sandbox-probe-"));
    const executable = join(directory, "sandbox-exec");
    const log = join(directory, "argv.log");
    writeFileSync(
      executable,
      `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(log)}\ncase "$*" in *"(allow default)"*) exit 0;; *"-f"*) exit 0;; *) exit 71;; esac\n`,
    );
    chmodSync(executable, 0o700);
    try {
      const adapter = createPlatformSandboxAdapter("darwin", executable, true, () => undefined);
      expect(adapter.supported).toBe(true);
      const result = await adapter.initialize({ workingDirectory: directory, readOnly: true });
      expect(result.ok).toBe(true);
      if (result.ok) await result.value.close();
      const argv = readFileSync(log, "utf8");
      expect(argv).toContain("(allow default)");
      expect(argv).not.toMatch(/^--$/m);
    } finally {
      rmSync(directory, { recursive: true, force: true });
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

  it("ignores the interactive PI_SEATBELT_PROFILE export", () => {
    const previous = process.env.PI_SEATBELT_PROFILE;
    process.env.PI_SEATBELT_PROFILE = "/tmp/session-profile.sb";
    try {
      const adapter = createPlatformSandboxAdapter("darwin", "/usr/bin/false", true);
      expect(adapter.supported).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PI_SEATBELT_PROFILE;
      else process.env.PI_SEATBELT_PROFILE = previous;
    }
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
          args: ["-f", profile, "/usr/bin/pi", "--mode", "json"],
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

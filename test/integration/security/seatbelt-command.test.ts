import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createSeatbeltProfile } from "../../../src/security/seatbelt-profile.js";

const exec = promisify(execFile);
const unavailableReason = (() => {
  if (process.platform !== "darwin")
    return `macOS Seatbelt required (platform: ${process.platform})`;
  try {
    execFileSync("/usr/bin/sandbox-exec", ["-p", "(version 1) (allow default)", "/usr/bin/true"], {
      stdio: "ignore",
    });
    return undefined;
  } catch {
    return "/usr/bin/sandbox-exec is unavailable or rejected the probe profile";
  }
})();
if (unavailableReason)
  console.info(`Skipping Chronos Seatbelt command integration: ${unavailableReason}`);
const runIf = unavailableReason ? describe.skip : describe;

runIf("run-specific Seatbelt command boundary", () => {
  it("allows approved reads/writes and denies an unapproved sibling", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "chronos-seatbelt-command-"));
    const sibling = await mkdtemp(join(tmpdir(), "chronos-seatbelt-sibling-"));
    await writeFile(join(workspace, "config"), "approved", "utf8");
    await writeFile(join(sibling, "secret"), "denied", "utf8");
    const profile = await createSeatbeltProfile({
      workingDirectory: workspace,
      readOnly: false,
      readPaths: [join(workspace, "config")],
      writePaths: [workspace],
      networkAllowed: false,
    });
    try {
      const read = await exec("/usr/bin/sandbox-exec", [
        "-f",
        profile.path,
        "/bin/cat",
        join(workspace, "config"),
      ]);
      expect(read.stdout).toBe("approved");
      await expect(
        exec("/usr/bin/sandbox-exec", ["-f", profile.path, "/bin/cat", join(sibling, "secret")]),
      ).rejects.toThrow();
      await exec("/usr/bin/sandbox-exec", [
        "-f",
        profile.path,
        "/bin/sh",
        "-c",
        `printf new > ${workspace}/report`,
      ]);
      expect(await readFile(join(workspace, "report"), "utf8")).toBe("new");
    } finally {
      await profile.close();
    }
  });
});

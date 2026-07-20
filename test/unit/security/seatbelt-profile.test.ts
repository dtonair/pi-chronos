import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createSeatbeltProfile,
  renderSeatbeltProfile,
} from "../../../src/security/seatbelt-profile.js";

describe("run-specific Seatbelt profile", () => {
  it("renders deny-first canonical approved roots and coarse network mode", () => {
    const profile = renderSeatbeltProfile({
      workingDirectory: "/tmp/job",
      readOnly: false,
      readPaths: ["/tmp/job/config"],
      writePaths: ["/tmp/job/report.md"],
      networkAllowed: false,
    });
    expect(profile.indexOf("(deny default)")).toBeGreaterThan(-1);
    expect(profile).toContain('(import "bsd.sb")');
    expect(profile).toContain("(allow process-exec)");
    expect(profile).toContain("(allow sysctl-read)");
    expect(profile.indexOf("(allow file-read*")).toBeGreaterThan(profile.indexOf("(deny default)"));
    expect(profile).toContain("/tmp/job/config");
    expect(profile).not.toContain("(allow network*)");
    expect(
      renderSeatbeltProfile({ workingDirectory: "/tmp/job", readOnly: true, networkAllowed: true }),
    ).toContain("(allow network*)");
  });

  it("owns a private 0700/0600 profile lifecycle", async () => {
    const handle = await createSeatbeltProfile({ workingDirectory: "/tmp/job", readOnly: true });
    try {
      expect((await stat(handle.directory)).mode & 0o777).toBe(0o700);
      expect((await stat(handle.path)).mode & 0o777).toBe(0o600);
      expect(await readFile(handle.path, "utf8")).toContain("(deny default)");
    } finally {
      await handle.close();
      await handle.close();
    }
  });
});

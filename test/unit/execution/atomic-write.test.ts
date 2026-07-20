import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWrite } from "../../../src/execution/atomic-write.js";

describe("atomic output replacement", () => {
  it("replaces only an approved target and leaves no temp file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chronos-atomic-"));
    const target = join(directory, "report.md");
    await writeFile(target, "old", "utf8");
    const permissions = {
      tools: ["chronos_atomic_write"],
      shell: { allowed: false, commands: [] },
      filesystem: { readPaths: [], writePaths: [directory] },
      network: { allowed: false, domains: [] },
      extensions: { allowedIds: [] },
      secrets: { allowedNames: [] },
      process: { allowed: false, commands: [] },
    };
    const result = await atomicWrite("report.md", "complete", {
      cwd: directory,
      permissions,
    });
    expect(result.ok).toBe(true);
    expect(await readFile(target, "utf8")).toBe("complete");
  });

  it("rejects an unapproved target before mutation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chronos-atomic-"));
    const result = await atomicWrite("outside.md", "no", {
      cwd: directory,
      permissions: {
        tools: ["chronos_atomic_write"],
        shell: { allowed: false, commands: [] },
        filesystem: { readPaths: [], writePaths: [] },
        network: { allowed: false, domains: [] },
        extensions: { allowedIds: [] },
        secrets: { allowedNames: [] },
      },
    });
    expect(result.ok).toBe(false);
  });
});

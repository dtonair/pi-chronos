import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPathAllowed } from "../../../src/security/path-policy.js";
import { DEFAULT_PERMISSIONS } from "../../fixtures/database.js";

describe("filesystem policy integration", () => {
  const directories: string[] = [];
  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  });

  it("rejects a sibling prefix", async () => {
    const result = await checkPathAllowed("/tmp-other/x", "/", "read", {
      ...DEFAULT_PERMISSIONS,
      filesystem: { readPaths: ["/tmp"], writePaths: [] },
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed when canonicalization is unavailable", async () => {
    const broken = {
      canonicalize: (path: string) => path,
      exists: async () => false,
      realpath: async () => {
        throw new Error("canonicalizer unavailable");
      },
    };
    const result = await checkPathAllowed(
      "file.txt",
      "/tmp",
      "read",
      { ...DEFAULT_PERMISSIONS, filesystem: { readPaths: ["/tmp"], writePaths: [] } },
      broken,
    );
    expect(result.ok).toBe(false);
  });

  it("rechecks the target after a symlink swap", async () => {
    const canonicalizer = {
      canonicalize: (path: string) => path,
      exists: async () => true,
      realpath: async (path: string) =>
        path === "/virtual/root" ? "/virtual/root" : "/outside/after-swap.txt",
    };
    const result = await checkPathAllowed(
      "file.txt",
      "/virtual/root",
      "read",
      { ...DEFAULT_PERMISSIONS, filesystem: { readPaths: ["/virtual/root"], writePaths: [] } },
      canonicalizer,
    );
    expect(result.ok).toBe(false);
  });

  it("resolves symlinks and separates read and write roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "chronos-path-"));
    const outside = await mkdtemp(join(tmpdir(), "chronos-outside-"));
    directories.push(root, outside);
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(outside, join(root, "escape"));
    const permissions = {
      ...DEFAULT_PERMISSIONS,
      filesystem: {
        readPaths: [root],
        writePaths: [join(root, "write")],
      },
    };
    const escaped = await checkPathAllowed("escape/secret.txt", root, "read", permissions);
    expect(escaped.ok).toBe(false);
    const readOnly = await checkPathAllowed("write/new.txt", root, "read", {
      ...permissions,
      filesystem: { readPaths: [join(root, "read")], writePaths: [join(root, "write")] },
    });
    expect(readOnly.ok).toBe(false);
    const write = await checkPathAllowed("write/new.txt", root, "write", permissions);
    expect(write.ok).toBe(true);
  });
});

import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UTCTimestamp } from "../../../src/domain/job.js";
import type { EffectivePermissions } from "../../../src/domain/permission.js";
import { PolicyManifestStore } from "../../../src/security/policy-manifest.js";

const time = (value: number): UTCTimestamp => value as UTCTimestamp;

const permissions = (readPaths = ["/tmp/chronos"]): EffectivePermissions => ({
  tools: ["read"],
  shell: { allowed: false, commands: [] },
  filesystem: { readPaths, writePaths: ["/tmp/chronos"] },
  network: { allowed: false, domains: [] },
  extensions: { allowedIds: [] },
  secrets: { allowedNames: [] },
  canonicalReadPaths: readPaths,
  canonicalWritePaths: ["/tmp/chronos"],
});

describe("policy manifests", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  });

  it("binds one manifest to its identity and rejects replay after cleanup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chronos-manifest-"));
    directories.push(directory);
    const store = new PolicyManifestStore(directory);
    const created = await store.create(
      {
        runId: "run-1",
        jobId: "job-1",
        ownerId: "owner-1",
        fingerprint: "a".repeat(64),
        permissions: permissions(),
      },
      time(1_000),
      1_000,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const expected = {
      runId: "run-1",
      jobId: "job-1",
      ownerId: "owner-1",
      fingerprint: "a".repeat(64),
    };
    const consumed = await store.readAndConsume(created.value.path, expected, time(1_500));
    expect(consumed.ok).toBe(true);
    const freshStoreReplay = await new PolicyManifestStore(directory).readAndConsume(
      created.value.path,
      expected,
      time(1_500),
    );
    expect(freshStoreReplay.ok).toBe(false);
    if (!freshStoreReplay.ok) expect(freshStoreReplay.error.code).toBe("MANIFEST_REPLAY");
    await store.remove(created.value.path);
    const replay = await store.readAndConsume(created.value.path, expected, time(1_500));
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe("MANIFEST_REPLAY");
  });

  it("rejects expired, broad-path, and non-private manifests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chronos-manifest-"));
    directories.push(directory);
    const store = new PolicyManifestStore(directory);
    const broad = await store.create(
      {
        runId: "run-broad",
        jobId: "job-1",
        ownerId: "owner-1",
        fingerprint: "b".repeat(64),
        permissions: permissions(["/"]),
      },
      time(1_000),
      1_000,
    );
    expect(broad.ok).toBe(true);
    if (!broad.ok) return;
    const expected = {
      runId: "run-broad",
      jobId: "job-1",
      ownerId: "owner-1",
      fingerprint: "b".repeat(64),
    };
    const rejectedBroad = await store.readAndConsume(broad.value.path, expected, time(1_500));
    expect(rejectedBroad.ok).toBe(false);

    const expired = await store.create(
      {
        runId: "run-expired",
        jobId: "job-1",
        ownerId: "owner-1",
        fingerprint: "c".repeat(64),
        permissions: permissions(),
      },
      time(1_000),
      100,
    );
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    const rejectedExpired = await store.readAndConsume(
      expired.value.path,
      { ...expected, runId: "run-expired", fingerprint: "c".repeat(64) },
      time(1_100),
    );
    expect(rejectedExpired.ok).toBe(false);
    if (!rejectedExpired.ok) expect(rejectedExpired.error.code).toBe("MANIFEST_EXPIRED");

    const privateManifest = await store.create(
      {
        runId: "run-mode",
        jobId: "job-1",
        ownerId: "owner-1",
        fingerprint: "d".repeat(64),
        permissions: permissions(),
      },
      time(2_000),
      1_000,
    );
    expect(privateManifest.ok).toBe(true);
    if (!privateManifest.ok) return;
    if (process.platform !== "win32") {
      await chmod(privateManifest.value.path, 0o644);
      const rejectedMode = await store.readAndConsume(
        privateManifest.value.path,
        { ...expected, runId: "run-mode", fingerprint: "d".repeat(64) },
        time(2_100),
      );
      expect(rejectedMode.ok).toBe(false);
    }
  });
});

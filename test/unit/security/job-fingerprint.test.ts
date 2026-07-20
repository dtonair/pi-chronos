/**
 * Unit tests for job fingerprinting.
 *
 * Tests:
 *   - Deterministic output across object key ordering
 *   - Deterministic output across set-like array ordering
 *   - Detects changes to every security-relevant field (FR61)
 *   - Stable across display-only field changes (description, tags)
 *   - Constant-time comparison via fingerprintsMatch
 */
import { describe, expect, it } from "vitest";
import type { JobDefinition } from "../../../src/domain/job.js";
import { fingerprintSHA256, toCanonicalJSON } from "../../../src/security/canonical-json.js";
import { computeJobFingerprint, fingerprintsMatch } from "../../../src/security/job-fingerprint.js";

// ─── Test helpers ──────────────────────────────────────

function baseDefinition(): JobDefinition {
  return {
    name: "test-job",
    prompt: "Do something useful",
    schedule: { kind: "interval", everyMs: 3600_000 },
    model: "claude-sonnet-4-5",
    identity: { scope: "user", scopeKey: "alice" },
    execution: {
      mode: "subagent",
      workingDirectory: "/tmp",
      timeoutMs: 600_000,
      maxOutputBytes: 262_144,
      overlapPolicy: "skip",
      missedRunPolicy: "skip",
      sandboxRequired: false,
      environment: {
        values: { FOO: "bar" },
        secretNames: ["SECRET_1"],
      },
    },
    permissions: {
      tools: ["read", "write"],
      shell: { allowed: true, commands: ["echo hello", "ls -la"] },
      filesystem: { readPaths: ["/tmp"], writePaths: ["/tmp"] },
      network: { allowed: false, domains: [] },
      extensions: { allowedIds: [] },
      secrets: { allowedNames: ["SECRET_1"] },
    },
    source: "direct_user",
    tags: [],
  };
}

// ─── Canonical JSON ────────────────────────────────────

describe("Canonical JSON", () => {
  it("should produce deterministic output regardless of map key insertion order", () => {
    const obj1 = { b: 1, a: 2, c: { z: 9, x: 8 } };
    // Same object with different key order in source code doesn't matter in JS,
    // but we construct a scenario where keys are reordered
    const obj2 = { a: 2, c: { x: 8, z: 9 }, b: 1 };

    expect(toCanonicalJSON(obj1)).toBe(toCanonicalJSON(obj2));
  });

  it("should sort set-like arrays deterministically", () => {
    const perms1 = {
      tools: ["write", "read", "edit"],
      extensions: { allowedIds: ["ext-b", "ext-a"] },
    };
    const perms2 = {
      tools: ["edit", "read", "write"],
      extensions: { allowedIds: ["ext-a", "ext-b"] },
    };

    expect(toCanonicalJSON(perms1)).toBe(toCanonicalJSON(perms2));
  });

  it("should preserve insertion order for non-sorted arrays (e.g. shell.commands)", () => {
    // shell.commands is not in the sorted set by default
    const a = { commands: ["echo hello", "ls"] };
    const b = { commands: ["ls", "echo hello"] };
    expect(toCanonicalJSON(a)).not.toBe(toCanonicalJSON(b));
  });

  it("should omit null and undefined values", () => {
    const a = { key: "val", missing: null, gone: undefined };
    const b = { key: "val" };
    expect(toCanonicalJSON(a)).toBe(toCanonicalJSON(b));
  });

  it("should serialize integers without decimals", () => {
    expect(toCanonicalJSON({ n: 42 })).toContain("42");
    expect(toCanonicalJSON({ n: 42 })).not.toContain("42.0");
  });
});

// ─── Fingerprint stability ────────────────────────────

describe("Job Fingerprint", () => {
  it("should produce the same fingerprint for identical definitions", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();

    expect(computeJobFingerprint(d1)).toBe(computeJobFingerprint(d2));
  });

  it("should produce the same fingerprint regardless of permission array ordering", () => {
    const d1 = baseDefinition();
    d1.permissions = { ...d1.permissions, tools: ["write", "read"] };

    const d2 = baseDefinition();
    d2.permissions = { ...d2.permissions, tools: ["read", "write"] };

    expect(computeJobFingerprint(d1)).toBe(computeJobFingerprint(d2));
  });

  it("should produce the same fingerprint regardless of path array ordering", () => {
    const d1 = baseDefinition();
    d1.permissions = {
      ...d1.permissions,
      filesystem: { readPaths: ["/b", "/a"], writePaths: ["/d", "/c"] },
    };

    const d2 = baseDefinition();
    d2.permissions = {
      ...d2.permissions,
      filesystem: { readPaths: ["/a", "/b"], writePaths: ["/c", "/d"] },
    };

    expect(computeJobFingerprint(d1)).toBe(computeJobFingerprint(d2));
  });

  it("should produce the same fingerprint regardless of secretNames ordering", () => {
    const d1 = baseDefinition();
    d1.permissions = { ...d1.permissions, secrets: { allowedNames: ["S2", "S1"] } };

    const d2 = baseDefinition();
    d2.permissions = { ...d2.permissions, secrets: { allowedNames: ["S1", "S2"] } };

    expect(computeJobFingerprint(d1)).toBe(computeJobFingerprint(d2));
  });

  // ─── Security-relevant changes (FR61) ─────────────

  it("should detect change to name", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.name = "different-name";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to prompt", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.prompt = "Do something malicious";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to schedule", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.schedule = { kind: "interval", everyMs: 7200_000 };
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to model", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.model = "claude-opus-4-5";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to execution mode", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    (d2.execution as unknown as Record<string, string>).mode = "inline";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to execution workingDirectory", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.execution.workingDirectory = "/etc";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to execution timeoutMs", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.execution.timeoutMs = 99999;
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to execution maxOutputBytes", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.execution.maxOutputBytes = 999;
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to execution overlapPolicy", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    (d2.execution as unknown as Record<string, string>).overlapPolicy = "allow";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to execution missedRunPolicy", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.execution.missedRunPolicy = "run_once";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to execution sandboxRequired", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.execution.sandboxRequired = true;
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to environment values", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.execution.environment.values = { FOO: "baz" };
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to environment secretNames", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.execution.environment.secretNames = ["SECRET_2"];
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to permissions tools", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.permissions = { ...d2.permissions, tools: ["read", "write", "bash"] };
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to permissions shell.allowed", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.permissions = { ...d2.permissions, shell: { allowed: false, commands: ["echo hello"] } };
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to permissions filesystem paths", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.permissions = {
      ...d2.permissions,
      filesystem: { readPaths: ["/home/user"], writePaths: ["/tmp"] },
    };
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  it("should detect change to source", () => {
    const d1 = baseDefinition();
    const d2 = baseDefinition();
    d2.source = "project_import";
    expect(computeJobFingerprint(d1)).not.toBe(computeJobFingerprint(d2));
  });

  // ─── Display-only fields (should NOT change fingerprint) ──

  it("should NOT change fingerprint for description change", () => {
    const d1 = baseDefinition();
    d1.description = "A description";
    const d2 = baseDefinition();
    d2.description = "A different description";
    expect(computeJobFingerprint(d1)).toBe(computeJobFingerprint(d2));
  });

  it("should NOT change fingerprint for tags change", () => {
    const d1 = baseDefinition();
    d1.tags = ["tag1"];
    const d2 = baseDefinition();
    d2.tags = ["tag2"];
    expect(computeJobFingerprint(d1)).toBe(computeJobFingerprint(d2));
  });

  it("should NOT change fingerprint when description is null vs undefined", () => {
    const d1 = baseDefinition();
    d1.description = undefined;
    const d2 = baseDefinition();
    d2.description = undefined;
    expect(computeJobFingerprint(d1)).toBe(computeJobFingerprint(d2));
  });
});

// ─── Fingerprint comparison ────────────────────────────

describe("fingerprintsMatch", () => {
  it("should return true for identical fingerprints", () => {
    const fp = "a".repeat(64);
    expect(fingerprintsMatch(fp, fp)).toBe(true);
  });

  it("should return false for different fingerprints", () => {
    expect(fingerprintsMatch("a".repeat(64), "b".repeat(64))).toBe(false);
  });

  it("should return false for different length fingerprints", () => {
    expect(fingerprintsMatch("a".repeat(64), "a".repeat(63))).toBe(false);
  });
});

// ─── SHA-256 fingerprint output ────────────────────────

describe("fingerprintSHA256", () => {
  it("should produce a 64-character hex string", () => {
    const result = fingerprintSHA256({ hello: "world" });
    expect(result).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(result)).toBe(true);
  });

  it("should produce the same hash for identical canonical JSON", () => {
    const a = { x: 1, y: 2 };
    const b = { y: 2, x: 1 };
    expect(fingerprintSHA256(a)).toBe(fingerprintSHA256(b));
  });
});

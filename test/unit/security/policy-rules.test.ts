import { describe, expect, it } from "vitest";
import {
  isDispatchable,
  isUserOperationAllowed,
  isValidTransition,
  requiresApproval,
  resolveInitialStatus,
} from "../../../src/security/approval-policy.js";
import { toCanonicalJSON } from "../../../src/security/canonical-json.js";
import { validateEnvironment } from "../../../src/security/environment-policy.js";
import { diffImportDefinitions } from "../../../src/security/import-diff.js";
import { authorizeToolCall } from "../../../src/security/policy-engine.js";
import { DEFAULT_PERMISSIONS } from "../../fixtures/database.js";

const toolPermissions = {
  ...DEFAULT_PERMISSIONS,
  tools: ["read", "write", "grep", "edit"],
};

const environment = (overrides: Record<string, unknown> = {}) =>
  ({
    values: {},
    secretNames: [],
    ...overrides,
  }) as never;

describe("security policy rules", () => {
  it("keeps source approval decisions conservative", () => {
    expect(
      resolveInitialStatus({ source: "tool", requestApproval: false, privileged: false }),
    ).toBe("pending_approval");
    expect(
      resolveInitialStatus({ source: "project_import", requestApproval: false, privileged: false }),
    ).toBe("pending_approval");
    expect(
      resolveInitialStatus({ source: "direct_user", requestApproval: false, privileged: false }),
    ).toBe("active");
    expect(
      resolveInitialStatus({ source: "direct_user", requestApproval: false, privileged: true }),
    ).toBe("pending_approval");
    expect(
      resolveInitialStatus({ source: "other" as never, requestApproval: false, privileged: false }),
    ).toBe("pending_approval");
    expect(isDispatchable("active")).toBe(true);
    expect(requiresApproval("pending_approval")).toBe(true);
    expect(isUserOperationAllowed("paused")).toBe(true);
    expect(isUserOperationAllowed("archived")).toBe(false);
    expect(isUserOperationAllowed("draft")).toBe(false);
    expect(isUserOperationAllowed("disabled")).toBe(false);
    expect(isValidTransition("active", "paused")).toBe(true);
    expect(isValidTransition("archived", "active")).toBe(false);
  });

  it("rejects invalid and reserved environment names", () => {
    expect(
      validateEnvironment(environment({ values: { "bad-name": "x" } }), DEFAULT_PERMISSIONS).ok,
    ).toBe(false);
    expect(
      validateEnvironment(environment({ values: { PATH: "x" } }), DEFAULT_PERMISSIONS).ok,
    ).toBe(false);
    expect(
      validateEnvironment(environment({ secretNames: ["TOKEN"] }), {
        ...DEFAULT_PERMISSIONS,
        secrets: { allowedNames: ["TOKEN"] },
      }).ok,
    ).toBe(true);
    expect(
      validateEnvironment(environment({ secretNames: ["MISSING"] }), DEFAULT_PERMISSIONS).ok,
    ).toBe(false);
  });

  it("canonicalizes set-like arrays, numbers, nulls, and cycles", () => {
    expect(toCanonicalJSON({ tools: ["write", "read"], ignored: null, number: 1.2 })).toBe(
      '{"number":1.200000,"tools":["read","write"]}',
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toCanonicalJSON(circular)).toBe('{"self":null}');
    expect(toCanonicalJSON({ value: null }, { omitNullish: false })).toBe('{"value":null}');
    expect(toCanonicalJSON(undefined)).toBe("null");
    expect(toCanonicalJSON(false)).toBe("false");
    expect(toCanonicalJSON(Number.NaN)).toBe("null");
    expect(toCanonicalJSON(1n)).toBe("1");
    expect(
      toCanonicalJSON({ values: [null, "b", "a"] }, { sortedArrays: new Set(["values"]) }),
    ).toBe('{"values":["a","b",null]}');
  });

  it("redacts sensitive import diffs and bounds them", () => {
    const diffs = diffImportDefinitions(
      { prompt: "old", description: "old", one: 1, two: 2 },
      { prompt: "new", description: "new", one: 2, two: 3 },
      2,
    );
    expect(diffs).toHaveLength(2);
    expect(diffs[0]?.sensitive).toBe(true);
    expect(diffs[0]?.before).toBe("[REDACTED]");
    expect(diffImportDefinitions({ same: 1 }, { same: 1 })).toEqual([]);
    expect(diffImportDefinitions({ a: 1, b: 1 }, { a: 2, b: 2 }, 0)).toEqual([]);
  });

  it("fails closed for unsupported, missing-input, and allowlisted tool paths", async () => {
    expect(
      (
        await authorizeToolCall(
          { tool: "unknown", input: {} },
          { cwd: "/tmp", permissions: DEFAULT_PERMISSIONS },
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await authorizeToolCall(
          { tool: "read", input: {} },
          { cwd: "/tmp", permissions: DEFAULT_PERMISSIONS },
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await authorizeToolCall(
          { tool: "bash", input: {} },
          { cwd: "/tmp", permissions: DEFAULT_PERMISSIONS },
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await authorizeToolCall(
          { tool: "write", input: { path: "file.txt" } },
          { cwd: "/tmp", permissions: DEFAULT_PERMISSIONS },
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await authorizeToolCall(
          { tool: "grep", input: { paths: ["file.txt"] } },
          { cwd: "/tmp", permissions: toolPermissions },
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await authorizeToolCall(
          { tool: "edit", input: { target: "file.txt" } },
          { cwd: "/tmp", permissions: toolPermissions },
        )
      ).ok,
    ).toBe(true);
  });
});

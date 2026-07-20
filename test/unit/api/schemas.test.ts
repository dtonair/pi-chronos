import { readFileSync } from "node:fs";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  decodeImportFile,
  decodeSchedulerToolInput,
  ImportFileSchema,
  JobPermissionsSchema,
  JobScheduleSchema,
  PersistedPermissionsSchema,
  SchedulerToolInputSchema,
} from "../../../src/api/schemas.js";
import { ChronosErrorCode } from "../../../src/domain/errors.js";
import { DENY_ALL_PERMISSIONS } from "../../../src/domain/permission.js";

function expectErrorCode(result: ReturnType<typeof decodeSchedulerToolInput>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe("schedule schemas and semantics", () => {
  it("keeps persisted process policy output strict while input remains legacy-compatible", () => {
    const value = {
      schemaVersion: 1,
      value: {
        tools: [],
        shell: { allowed: false, commands: [] },
        filesystem: { readPaths: [], writePaths: [] },
        network: { allowed: false, domains: [] },
        extensions: { allowedIds: [] },
        secrets: { allowedNames: [] },
        process: { allowed: false, commands: [] },
      },
    };
    expect(Value.Check(PersistedPermissionsSchema, value)).toBe(true);
    expect(
      Value.Check(PersistedPermissionsSchema, { ...value, value: { ...value.value, extra: true } }),
    ).toBe(false);
  });
  it("accepts the exact once schedule contract", () => {
    expect(
      Value.Check(JobScheduleSchema, {
        kind: "once",
        runAt: "2026-08-01T12:00:00Z",
      }),
    ).toBe(true);
  });

  it("requires a timezone for an offset-free once schedule", () => {
    const result = decodeSchedulerToolInput({
      action: "preview",
      schedule: { kind: "once", runAt: "2026-08-01T12:00:00" },
    });
    expectErrorCode(result, ChronosErrorCode.INVALID_SCHEDULE);
  });

  it("accepts an offset-free once schedule with an IANA timezone", () => {
    const result = decodeSchedulerToolInput({
      action: "preview",
      schedule: {
        kind: "once",
        runAt: "2026-08-01T12:00:00",
        timezone: "America/New_York",
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a malformed timestamp", () => {
    const result = decodeSchedulerToolInput({
      action: "preview",
      schedule: { kind: "once", runAt: "tomorrow" },
    });
    expectErrorCode(result, ChronosErrorCode.INVALID_SCHEDULE);
  });

  it("enforces the trusted minimum interval", () => {
    const result = decodeSchedulerToolInput({
      action: "preview",
      schedule: { kind: "interval", everyMs: 59_999 },
    });
    expectErrorCode(result, ChronosErrorCode.INVALID_SCHEDULE);
  });

  it("rejects six-field cron expressions", () => {
    const result = decodeSchedulerToolInput({
      action: "preview",
      schedule: { kind: "cron", expression: "0 0 9 * * 1", timezone: "UTC" },
    });
    expectErrorCode(result, ChronosErrorCode.INVALID_SCHEDULE);
  });

  it("rejects invalid IANA zones with a stable code", () => {
    const result = decodeSchedulerToolInput({
      action: "preview",
      schedule: { kind: "cron", expression: "0 9 * * *", timezone: "Mars/Olympus" },
    });
    expectErrorCode(result, ChronosErrorCode.TIMEZONE_INVALID);
  });
});

describe("scheduler action validation", () => {
  it("uses the FR1 action names", () => {
    for (const action of [
      "preview",
      "create",
      "get",
      "list",
      "update",
      "pause",
      "resume",
      "archive",
      "delete",
      "run_now",
      "cancel_run",
      "history",
      "approve",
      "revoke_approval",
      "import",
      "health",
    ]) {
      expect(Value.Check(SchedulerToolInputSchema, { action })).toBe(true);
    }
    expect(Value.Check(SchedulerToolInputSchema, { action: "create_job" })).toBe(false);
  });

  it("rejects create without required action fields", () => {
    expectErrorCode(
      decodeSchedulerToolInput({ action: "create" }),
      ChronosErrorCode.VALIDATION_ERROR,
    );
  });

  it("accepts a minimal create and defaults capabilities to the application deny-all policy", () => {
    const result = decodeSchedulerToolInput({
      action: "create",
      name: "daily report",
      prompt: "Generate the report",
      schedule: { kind: "interval", everyMs: 60_000 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.permissions).toBeUndefined();
    expect(DENY_ALL_PERMISSIONS.tools).toEqual([]);
  });

  it("rejects update without expectedRevision", () => {
    const result = decodeSchedulerToolInput({
      action: "update",
      jobId: "job-1",
      patch: { name: "new name" },
    });
    expectErrorCode(result, ChronosErrorCode.VALIDATION_ERROR);
  });

  it("rejects fields that do not belong to an action", () => {
    const result = decodeSchedulerToolInput({ action: "health", jobId: "job-1" });
    expectErrorCode(result, ChronosErrorCode.VALIDATION_ERROR);
  });

  it("rejects unknown fields before application logic", () => {
    const result = decodeSchedulerToolInput({ action: "health", secretPassword: "hunter2" });
    expectErrorCode(result, ChronosErrorCode.VALIDATION_ERROR);
  });

  it("returns UNSUPPORTED_TOOL for unknown child tools", () => {
    const result = decodeSchedulerToolInput({
      action: "create",
      name: "job",
      prompt: "work",
      schedule: { kind: "interval", everyMs: 60_000 },
      permissions: { ...DENY_ALL_PERMISSIONS, tools: ["scheduler"] },
    });
    expectErrorCode(result, ChronosErrorCode.UNSUPPORTED_TOOL);
  });

  it("returns UNSUPPORTED_OPERATION for extension requests", () => {
    const result = decodeSchedulerToolInput({
      action: "create",
      name: "job",
      prompt: "work",
      schedule: { kind: "interval", everyMs: 60_000 },
      permissions: {
        ...DENY_ALL_PERMISSIONS,
        extensions: { allowedIds: ["third-party"] },
      },
    });
    expectErrorCode(result, ChronosErrorCode.UNSUPPORTED_OPERATION);
  });

  it("accepts the complete permission shape", () => {
    expect(Value.Check(JobPermissionsSchema, DENY_ALL_PERMISSIONS)).toBe(true);
  });

  it("enforces the 100-character job name limit", () => {
    const result = decodeSchedulerToolInput({
      action: "create",
      name: "x".repeat(101),
      prompt: "work",
      schedule: { kind: "interval", everyMs: 60_000 },
    });
    expectErrorCode(result, ChronosErrorCode.VALIDATION_ERROR);
  });
});

describe("import validation", () => {
  it("accepts a strict versioned import with an explicit model", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../../fixtures/import/valid.json", import.meta.url), "utf8"),
    );
    const result = decodeImportFile(fixture);
    expect(result.ok).toBe(true);
  });

  it("rejects imported jobs without a model", () => {
    const result = decodeImportFile({
      version: 1,
      jobs: [
        {
          key: "daily-report",
          name: "Daily report",
          prompt: "Generate report",
          schedule: { kind: "interval", everyMs: 60_000 },
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ChronosErrorCode.VALIDATION_ERROR);
  });

  it("rejects unknown sensitive fields", () => {
    const result = decodeImportFile({
      version: 1,
      jobs: [],
      approvedFingerprint: "not-trust",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects more than 1000 jobs", () => {
    const jobs = Array.from({ length: 1_001 }, (_, index) => ({
      key: `job-${index}`,
      name: `job-${index}`,
      prompt: "work",
      schedule: { kind: "interval", everyMs: 60_000 },
      model: "test/model",
    }));
    expect(Value.Check(ImportFileSchema, { version: 1, jobs })).toBe(false);
  });
});

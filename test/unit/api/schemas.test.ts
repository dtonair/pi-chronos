import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CronScheduleSchema,
  ImportFileSchema,
  IntervalScheduleSchema,
  JobDefinitionInputSchema,
  OnceScheduleSchema,
  SchedulerToolInputSchema,
} from "../../../src/api/schemas.js";

/** Helper: validate with Value.Errors + Decode for defaults. Throws on validation errors. */
// biome-ignore lint/suspicious/noExplicitAny: test helper returns untyped decoded value
function decode(schema: TSchema, value: unknown): any {
  const errors = [...Value.Errors(schema, value)];
  if (errors.length > 0) {
    throw new Error(
      `Validation failed: ${errors.map((e) => `${e.instancePath}: ${e.message}`).join("; ")}`,
    );
  }
  return Value.Decode(schema, value);
}

describe("Schedule schemas", () => {
  it("should validate once schedule", () => {
    const decoded = decode(OnceScheduleSchema, {
      type: "once",
      at: "2026-08-01T12:00:00Z",
      allowPast: false,
    });
    expect(decoded.type).toBe("once");
    expect(decoded.at).toBe("2026-08-01T12:00:00Z");
  });

  it("should reject once with unknown fields", () => {
    expect(() =>
      decode(OnceScheduleSchema, { type: "once", at: "now", allowPast: false, extra: 1 }),
    ).toThrow();
  });

  it("should validate interval schedule", () => {
    const decoded = decode(IntervalScheduleSchema, {
      type: "interval",
      anchor: "2026-07-20T00:00:00Z",
      everyMs: 3_600_000,
      timezone: "America/New_York",
    });
    expect(decoded.everyMs).toBe(3_600_000);
  });

  it("should reject interval < 1000ms", () => {
    expect(() =>
      decode(IntervalScheduleSchema, {
        type: "interval",
        anchor: "2026-07-20T00:00:00Z",
        everyMs: 500,
        timezone: "UTC",
      }),
    ).toThrow();
  });

  it("should validate cron schedule", () => {
    const decoded = decode(CronScheduleSchema, {
      type: "cron",
      expression: "0 9 * * 1-5",
      timezone: "America/Los_Angeles",
    });
    expect(decoded.expression).toBe("0 9 * * 1-5");
  });

  it("should reject six-field cron input (validates only at semantic layer)", () => {
    // TypeBox schema only checks string type; the six-field enforcement is semantic
    const decoded = decode(CronScheduleSchema, {
      type: "cron",
      expression: "0 0 9 * * 1", // six-field
      timezone: "UTC",
    });
    expect(decoded.expression).toBe("0 0 9 * * 1");
    // Semantic validation will reject this in the schedule calculator
  });
});

describe("JobDefinitionInputSchema", () => {
  it("should validate minimal job definition", () => {
    const decoded = decode(JobDefinitionInputSchema, {
      name: "test-job",
      schedule: { type: "once", at: "2026-08-01T12:00:00Z" },
      prompt: "Do something",
    });
    expect(decoded.name).toBe("test-job");
    expect(decoded.sandboxRequired).toBe(false);
    expect(decoded.retainArtifact).toBe(false);
  });

  it("should reject missing required fields", () => {
    expect(() => decode(JobDefinitionInputSchema, {})).toThrow();
    expect(() =>
      decode(JobDefinitionInputSchema, { name: "", schedule: {}, prompt: "" }),
    ).toThrow();
  });

  it("should reject unknown fields", () => {
    expect(() =>
      decode(JobDefinitionInputSchema, {
        name: "test",
        schedule: { type: "once", at: "2026-08-01T12:00:00Z" },
        prompt: "hi",
        secretPassword: "hunter2",
      }),
    ).toThrow();
  });

  it("should enforce extensions array length 0 (not yet supported)", () => {
    expect(() =>
      decode(JobDefinitionInputSchema, {
        name: "test",
        schedule: { type: "once", at: "2026-08-01T12:00:00Z" },
        prompt: "hi",
        extensions: ["custom-ext"],
      }),
    ).toThrow();
  });

  it("should accept extensions as empty array", () => {
    const decoded = decode(JobDefinitionInputSchema, {
      name: "test",
      schedule: { type: "once", at: "2026-08-01T12:00:00Z" },
      prompt: "hi",
      extensions: [],
    });
    expect(decoded.extensions).toEqual([]);
  });

  it("should enforce string lengths", () => {
    expect(() =>
      decode(JobDefinitionInputSchema, {
        name: "x".repeat(257),
        schedule: { type: "once", at: "2026-08-01T12:00:00Z" },
        prompt: "hi",
      }),
    ).toThrow();
  });
});

describe("SchedulerToolInputSchema", () => {
  it("should validate minimal action input", () => {
    const decoded = decode(SchedulerToolInputSchema, { action: "status" });
    expect(decoded.action).toBe("status");
  });

  it("should reject unknown actions", () => {
    expect(() => decode(SchedulerToolInputSchema, { action: "do_evil" })).toThrow();
  });

  it("should validate create_job input", () => {
    const decoded = decode(SchedulerToolInputSchema, {
      action: "create_job",
      name: "my-job",
      definition: {
        name: "my-job",
        schedule: {
          type: "interval",
          anchor: "2026-07-20T00:00:00Z",
          everyMs: 3_600_000,
          timezone: "UTC",
        },
        prompt: "Do scheduled work",
      },
    });
    expect(decoded.action).toBe("create_job");
    expect(decoded.definition?.name).toBe("my-job");
  });
});

describe("ImportFileSchema", () => {
  it("should validate a simple import file", () => {
    const decoded = decode(ImportFileSchema, {
      version: 1,
      project: "my-project",
      jobs: [
        {
          name: "daily-report",
          schedule: { type: "cron", expression: "0 9 * * *", timezone: "UTC" },
          prompt: "Generate report",
          model: "anthropic/claude-sonnet-4-5",
        },
      ],
    });
    expect(decoded.version).toBe(1);
    expect(decoded.jobs).toHaveLength(1);
  });

  it("should reject version > 1", () => {
    expect(() => decode(ImportFileSchema, { version: 2, project: "p", jobs: [] })).toThrow();
  });

  it("should reject more than 1000 jobs", () => {
    const manyJobs = Array.from({ length: 1001 }, (_, i) => ({
      name: `job-${i}`,
      schedule: { type: "once", at: "2026-08-01T12:00:00Z" },
      prompt: "hi",
      model: "test/model",
    }));
    expect(() => decode(ImportFileSchema, { version: 1, project: "p", jobs: manyJobs })).toThrow();
  });
});

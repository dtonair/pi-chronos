import { describe, expect, it } from "vitest";
import { ChronosError, ChronosErrorCode } from "../../../src/domain/errors.js";
import { isTerminalRunStatus, TERMINAL_RUN_STATUSES } from "../../../src/domain/run.js";

describe("ChronosError", () => {
  it("should create a ChronosError with code and message", () => {
    const err = new ChronosError({
      code: ChronosErrorCode.JOB_NOT_FOUND,
      message: "Job not found",
      entity: "job-1",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ChronosError);
    expect(err.code).toBe(ChronosErrorCode.JOB_NOT_FOUND);
    expect(err.message).toBe("Job not found");
    expect(err.entity).toBe("job-1");
    expect(err.name).toBe("ChronosError");
  });

  it("should wrap another error", () => {
    const cause = new Error("underlying");
    const err = ChronosError.wrap(
      ChronosErrorCode.DB_LOCKED,
      "Database locked",
      cause,
      "/data/chronos.db",
    );
    expect(err.code).toBe(ChronosErrorCode.DB_LOCKED);
    expect(err.cause).toBe(cause);
    expect(err.entity).toBe("/data/chronos.db");
  });

  it("should serialize to JSON", () => {
    const err = new ChronosError({
      code: ChronosErrorCode.JOB_NAME_CONFLICT,
      message: "Name conflict",
      meta: { existingId: "abc" },
    });
    const json = err.toJSON();
    expect(json).toEqual({
      code: "JOB_NAME_CONFLICT",
      message: "Name conflict",
      entity: undefined,
      meta: { existingId: "abc" },
    });
  });
});

describe("Run status helpers", () => {
  it("should identify terminal statuses", () => {
    for (const status of TERMINAL_RUN_STATUSES) {
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  });

  it("should reject non-terminal statuses", () => {
    expect(isTerminalRunStatus("queued")).toBe(false);
    expect(isTerminalRunStatus("claimed")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
  });

  it("should return true for all terminal values", () => {
    expect(TERMINAL_RUN_STATUSES.has("succeeded")).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has("failed")).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has("timed_out")).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has("cancelled")).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has("abandoned")).toBe(true);
    expect(TERMINAL_RUN_STATUSES.has("skipped")).toBe(true);
  });
});

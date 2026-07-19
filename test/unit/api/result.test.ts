import { describe, expect, it } from "vitest";
import { toSchedulerError } from "../../../src/api/result.js";
import { ChronosError, ChronosErrorCode } from "../../../src/domain/errors.js";

describe("SchedulerResult", () => {
  it("uses the structured error envelope", () => {
    const result = toSchedulerError(
      new ChronosError({
        code: ChronosErrorCode.JOB_NOT_FOUND,
        message: "Job not found",
        entity: "job-1",
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "JOB_NOT_FOUND",
        message: "Job not found",
        details: { entity: "job-1" },
      },
    });
    expect("code" in result).toBe(false);
  });
});

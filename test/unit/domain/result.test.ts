import { describe, expect, it } from "vitest";
import { ChronosError, ChronosErrorCode } from "../../../src/domain/errors.js";
import { err, ok, tryCatch, tryCatchAsync } from "../../../src/shared/result.js";

describe("Result", () => {
  it("should create Ok values", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  it("should create Err values", () => {
    const e = new ChronosError({
      code: ChronosErrorCode.INTERNAL_ERROR,
      message: "fail",
    });
    const r = err(e);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(e);
    }
  });

  it("should differentiate Ok from Err", () => {
    const success = ok("hello");
    const failure = err(new ChronosError({ code: ChronosErrorCode.JOB_NOT_FOUND, message: "no" }));

    if (success.ok) {
      expect(success.value).toBe("hello");
    } else {
      expect.fail("should be Ok");
    }

    if (!failure.ok) {
      expect(failure.error.code).toBe("JOB_NOT_FOUND");
    } else {
      expect.fail("should be Err");
    }
  });
});

describe("tryCatch", () => {
  it("should return Ok for non-throwing fn", () => {
    const result = tryCatch(
      () => JSON.parse('{"a": 1}'),
      ChronosErrorCode.MALFORMED_JSON,
      "bad json",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ a: 1 });
    }
  });

  it("should return Err for throwing fn", () => {
    const result = tryCatch(
      () => JSON.parse("not json"),
      ChronosErrorCode.MALFORMED_JSON,
      "bad json",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.MALFORMED_JSON);
      expect(result.error.cause).toBeInstanceOf(SyntaxError);
    }
  });
});

describe("tryCatchAsync", () => {
  it("should return Ok for resolving async fn", async () => {
    const result = await tryCatchAsync(
      () => Promise.resolve("good"),
      ChronosErrorCode.INTERNAL_ERROR,
      "error",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("good");
    }
  });

  it("should return Err for rejecting async fn", async () => {
    const result = await tryCatchAsync(
      () => Promise.reject(new Error("boom")),
      ChronosErrorCode.MIGRATION_ERROR,
      "migration failed",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ChronosErrorCode.MIGRATION_ERROR);
    }
  });
});

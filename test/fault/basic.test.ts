import { describe, expect, it } from "vitest";
import { ChronosError, ChronosErrorCode } from "../../src/domain/errors.js";

describe("fault diagnostics", () => {
  it("uses stable migration error codes", () => {
    expect(
      new ChronosError({ code: ChronosErrorCode.MIGRATION_ERROR, message: "failure" }).code,
    ).toBe("MIGRATION_ERROR");
  });
});

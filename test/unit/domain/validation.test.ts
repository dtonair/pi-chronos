import { describe, expect, it } from "vitest";
import { ChronosErrorCode } from "../../../src/domain/errors.js";
import {
  isArray,
  isBoolean,
  isInteger,
  isNumber,
  isRecord,
  isString,
  validateBoolean,
  validateInteger,
  validateString,
  validateStringArray,
} from "../../../src/shared/validation.js";

describe("Type guards", () => {
  it("isRecord", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord("str")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });

  it("isString", () => {
    expect(isString("")).toBe(true);
    expect(isString("a")).toBe(true);
    expect(isString(42)).toBe(false);
    expect(isString(null)).toBe(false);
  });

  it("isNumber", () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(3.14)).toBe(true);
    expect(isNumber(NaN)).toBe(false);
    expect(isNumber(Infinity)).toBe(true);
  });

  it("isInteger", () => {
    expect(isInteger(0)).toBe(true);
    expect(isInteger(42)).toBe(true);
    expect(isInteger(3.14)).toBe(false);
    expect(isInteger(NaN)).toBe(false);
  });

  it("isBoolean", () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isBoolean("true")).toBe(false);
  });

  it("isArray", () => {
    expect(isArray([])).toBe(true);
    expect(isArray([1, 2])).toBe(true);
    expect(isArray({})).toBe(false);
    expect(isArray("str")).toBe(false);
  });
});

describe("validateString", () => {
  it("accepts valid strings", () => {
    const r = validateString("hello", "name");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("hello");
  });

  it("rejects non-strings", () => {
    const r = validateString(42, "name");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ChronosErrorCode.INVALID_JOB_DEFINITION);
  });

  it("rejects strings below minLength", () => {
    const r = validateString("ab", "name", 3);
    expect(r.ok).toBe(false);
  });

  it("rejects strings above maxLength", () => {
    const r = validateString("abcdef", "name", 0, 5);
    expect(r.ok).toBe(false);
  });
});

describe("validateInteger", () => {
  it("accepts valid integers", () => {
    const r = validateInteger(42, "limit");
    expect(r.ok).toBe(true);
  });

  it("rejects non-integers", () => {
    const r = validateInteger(3.14, "limit");
    expect(r.ok).toBe(false);
  });

  it("rejects below min", () => {
    const r = validateInteger(1, "limit", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(ChronosErrorCode.VALUE_OUT_OF_RANGE);
  });

  it("rejects above max", () => {
    const r = validateInteger(200, "limit", 0, 100);
    expect(r.ok).toBe(false);
  });
});

describe("validateBoolean", () => {
  it("accepts true/false", () => {
    expect(validateBoolean(true, "flag").ok).toBe(true);
    expect(validateBoolean(false, "flag").ok).toBe(true);
  });

  it("rejects non-boolean", () => {
    expect(validateBoolean("yes", "flag").ok).toBe(false);
    expect(validateBoolean(1, "flag").ok).toBe(false);
  });
});

describe("validateStringArray", () => {
  it("accepts string arrays", () => {
    const r = validateStringArray(["a", "b"], "items");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(["a", "b"]);
  });

  it("accepts empty arrays", () => {
    const r = validateStringArray([], "items");
    expect(r.ok).toBe(true);
  });

  it("rejects non-arrays", () => {
    const r = validateStringArray("not array", "items");
    expect(r.ok).toBe(false);
  });

  it("rejects arrays with non-string elements", () => {
    const r = validateStringArray(["a", 42, "c"], "items");
    expect(r.ok).toBe(false);
  });
});

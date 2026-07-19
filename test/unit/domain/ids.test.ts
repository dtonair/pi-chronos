import { describe, expect, it } from "vitest";
import { createDeterministicIdGenerator, createIdGenerator } from "../../../src/shared/ids.js";

describe("IdGenerator", () => {
  it("should generate hex strings of the right length", () => {
    const gen = createIdGenerator();
    expect(gen.length).toBe(32);
    const id = gen.generate();
    expect(id).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(id)).toBe(true);
  });

  it("should produce unique values", () => {
    const gen = createIdGenerator();
    const ids = new Set(Array.from({ length: 100 }, () => gen.generate()));
    expect(ids.size).toBe(100);
  });
});

describe("DeterministicIdGenerator", () => {
  it("should generate predictable sequence", () => {
    const gen = createDeterministicIdGenerator("x-");
    expect(gen.generate()).toBe("x-00000001");
    expect(gen.generate()).toBe("x-00000002");
    expect(gen.generate()).toBe("x-00000003");
  });
});

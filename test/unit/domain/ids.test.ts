import { describe, expect, it } from "vitest";
import { createDeterministicIdGenerator, createIdGenerator } from "../../../src/shared/ids.js";

describe("IdGenerator", () => {
  it("should generate UUIDs", () => {
    const gen = createIdGenerator();
    expect(gen.length).toBe(36);
    const id = gen.generate();
    expect(id).toHaveLength(36);
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)).toBe(
      true,
    );
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

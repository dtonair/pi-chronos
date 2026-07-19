import { describe, expect, it } from "vitest";

describe("Module import", () => {
  it("should import the public API without opening files or resources", async () => {
    const mod = await import("../../../src/index.js");
    expect(mod.ok).toBeInstanceOf(Function);
    expect(mod.err).toBeInstanceOf(Function);
    expect(mod.chronosExtension).toBeInstanceOf(Function);
    expect(mod.ChronosError).toBeDefined();
    expect(mod.ChronosErrorCode).toBeDefined();
    expect(mod.SchedulerAction).toBeDefined();
  });

  it("should load the extension factory without side effects", async () => {
    const mod = await import("../../../src/extension/index.js");
    const factory = mod.default;
    expect(factory).toBeInstanceOf(Function);

    // Call the factory with a minimal fake pi object
    let called = false;
    const fakePi = {
      on: () => {
        called = true;
      },
    };
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub for factory test
    factory(fakePi as any);
    // Phase 1 factory does nothing beyond static registration
    expect(called).toBe(false);
  });
});

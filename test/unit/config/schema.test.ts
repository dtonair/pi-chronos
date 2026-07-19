import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { createConfig } from "../../../src/config/schema.js";

describe("Config", () => {
  it("should return defaults with no overrides", () => {
    const config = createConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("should create independent copies", () => {
    const a = createConfig();
    const b = createConfig();
    expect(a).not.toBe(b);
    expect(a.defaults).not.toBe(b.defaults);
  });

  it("should merge top-level overrides", () => {
    const config = createConfig({ maxConcurrentChildren: 8 });
    expect(config.maxConcurrentChildren).toBe(8);
    expect(config.pollIntervalMs).toBe(DEFAULT_CONFIG.pollIntervalMs);
  });

  it("should merge nested defaults overrides", () => {
    const config = createConfig({
      defaults: {
        timeoutMs: 60_000,
      },
    });
    expect(config.defaults.timeoutMs).toBe(60_000);
    expect(config.defaults.graceMs).toBe(DEFAULT_CONFIG.defaults.graceMs);
  });

  it("should merge nested importLimits overrides", () => {
    const config = createConfig({
      importLimits: {
        maxFileBytes: 5_000_000,
      },
    });
    expect(config.importLimits.maxFileBytes).toBe(5_000_000);
    expect(config.importLimits.maxJobs).toBe(DEFAULT_CONFIG.importLimits.maxJobs);
  });
});

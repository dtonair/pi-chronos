import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import { createConfig, decodeConfig } from "../../../src/config/schema.js";
import { ChronosError, ChronosErrorCode } from "../../../src/domain/errors.js";

describe("Chronos configuration", () => {
  it("matches the specification defaults", () => {
    expect(createConfig()).toEqual({
      defaultTimezone: "UTC",
      minimumIntervalMs: 60_000,
      defaultTimeoutMs: 600_000,
      maximumTimeoutMs: 86_400_000,
      defaultMaxOutputBytes: 262_144,
      maximumConcurrentRuns: 4,
      schedulerPollFallbackMs: 60_000,
      leaseDurationMs: 60_000,
      leaseRenewalMs: 20_000,
      instanceHeartbeatMs: 15_000,
      instanceStaleAfterMs: 60_000,
      shutdownGraceMs: 5_000,
      allowProjectImports: true,
      enableWidget: true,
      enableOsSandbox: false,
      maximumImportBytes: 1_048_576,
      maximumImportJobs: 1_000,
    });
  });

  it("creates independent copies", () => {
    expect(createConfig()).not.toBe(createConfig());
  });

  it("merges trusted overrides", () => {
    const config = createConfig({ maximumConcurrentRuns: 8 });
    expect(config.maximumConcurrentRuns).toBe(8);
    expect(config.defaultTimeoutMs).toBe(DEFAULT_CONFIG.defaultTimeoutMs);
  });

  it("rejects unknown fields", () => {
    const result = decodeConfig({ arbitraryProjectSetting: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ChronosErrorCode.VALIDATION_ERROR);
  });

  it("rejects malformed and out-of-range values", () => {
    expect(decodeConfig({ maximumConcurrentRuns: 0 }).ok).toBe(false);
    expect(decodeConfig({ leaseDurationMs: "forever" }).ok).toBe(false);
  });

  it("rejects invalid IANA timezones with a stable code", () => {
    const result = decodeConfig({ defaultTimezone: "Mars/Olympus" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ChronosErrorCode.TIMEZONE_INVALID);
  });

  it("rejects semantically inconsistent timing configuration", () => {
    expect(decodeConfig({ leaseDurationMs: 20_000, leaseRenewalMs: 20_000 }).ok).toBe(false);
    expect(decodeConfig({ instanceHeartbeatMs: 60_000, instanceStaleAfterMs: 60_000 }).ok).toBe(
      false,
    );
    expect(decodeConfig({ defaultTimeoutMs: 20_000, maximumTimeoutMs: 10_000 }).ok).toBe(false);
  });

  it("throws a structured error when createConfig receives invalid runtime input", () => {
    expect(() => createConfig({ unexpected: true })).toThrow(ChronosError);
  });
});

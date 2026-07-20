import { describe, expect, it } from "vitest";
import { createHealthSnapshot } from "../../../src/observability/health.js";

describe("health snapshot", () => {
  it("merges nested enforcement state and returns a clone", () => {
    const health = createHealthSnapshot({ queueDepth: 2 });
    health.update({ enforcement: { toolAndPathPolicy: "active", osSandbox: "unavailable" } });
    const value = health.get();
    expect(value.queueDepth).toBe(2);
    expect(value.enforcement.osSandbox).toBe("unavailable");
    value.enforcement.osSandbox = "disabled";
    expect(health.get().enforcement.osSandbox).toBe("unavailable");
  });
});

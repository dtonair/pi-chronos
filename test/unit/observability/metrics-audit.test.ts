import { describe, expect, it } from "vitest";
import { persistAudit } from "../../../src/observability/audit.js";
import { createMetrics } from "../../../src/observability/metrics.js";
import { createTestDatabase } from "../../fixtures/database.js";

describe("observability adapters", () => {
  it("maintains an isolated metrics snapshot", () => {
    const metrics = createMetrics();
    metrics.increment("wakes");
    metrics.increment("failed", 2);
    const snapshot = metrics.snapshot();
    expect(snapshot.wakes).toBe(1);
    expect(snapshot.failed).toBe(2);
    snapshot.wakes = 99;
    expect(metrics.snapshot().wakes).toBe(1);
  });

  it("persists audit events without throwing on invalid adapters", () => {
    const db = createTestDatabase();
    expect(
      persistAudit(db.adapter, {
        id: "audit-test",
        type: "job.created",
        timestamp: 1_700_000_000_000 as never,
        entityId: "job",
        actor: "test",
        payload: {},
        message: "created",
      }),
    ).toBe(true);
    expect(
      persistAudit(
        {
          run: () => {
            throw new Error("broken");
          },
        } as never,
        {
          id: "audit-fail",
          type: "job.created",
          timestamp: 1_700_000_000_000 as never,
          entityId: "job",
          actor: "test",
          payload: {},
          message: "created",
        },
      ),
    ).toBe(false);
    db.close();
  });
});

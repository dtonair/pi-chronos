import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInstanceCoordinator } from "../../../src/scheduler/instance-coordinator.js";
import { createEventBus } from "../../../src/shared/event-bus.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import { getInstanceById } from "../../../src/storage/repositories/instance-repository.js";
import { createTestDatabase, type TestDb } from "../../fixtures/database.js";
import { createFakeClock } from "../../fixtures/fake-clock.js";

const now = 1_700_000_000_000 as never;

describe("scheduler instance coordinator", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it("registers once, heartbeats, and records an idempotent stop", () => {
    const clock = createFakeClock(now);
    const events = createEventBus();
    const seen: string[] = [];
    events.onAny((event) => seen.push(event.type));
    const coordinator = createInstanceCoordinator({
      adapter: db.adapter,
      clock,
      ids: createDeterministicIdGenerator("instance-"),
      id: "instance-test",
      heartbeatMs: 1_000,
      events,
    });
    const first = coordinator.start();
    const second = coordinator.start();
    expect(first.id).toBe(second.id);
    expect(clock.pending).toBe(1);
    clock.advance(1_000);
    expect(getInstanceById(db.adapter, first.id)?.heartbeatAt).toBe(now + 1_000);
    expect(seen).toContain("instance.heartbeat");
    coordinator.stop();
    coordinator.stop();
    coordinator.heartbeat();
    expect(coordinator.running).toBe(false);
    expect(clock.pending).toBe(0);
    expect(getInstanceById(db.adapter, first.id)?.stoppedAt).toBe(now + 1_000);
    coordinator.start();
    coordinator.stop();
    expect(getInstanceById(db.adapter, first.id)?.stoppedAt).toBe(now + 1_000);
    const configured = createInstanceCoordinator({
      adapter: db.adapter,
      clock,
      ids: createDeterministicIdGenerator("configured-"),
      host: "configured-host",
      processId: 42,
    });
    configured.start();
    configured.stop();
  });
});

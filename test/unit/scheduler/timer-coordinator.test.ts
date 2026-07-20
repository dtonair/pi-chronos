import { describe, expect, it } from "vitest";
import { createTimerCoordinator } from "../../../src/scheduler/timer-coordinator.js";
import { createFakeClock } from "../../fixtures/fake-clock.js";

const sink = () => {
  const events: string[] = [];
  return {
    events,
    emit(event: { type: string }) {
      events.push(event.type);
    },
    on: () => () => undefined,
  };
};

describe("bounded timer coordinator", () => {
  it("arms one timer, polls for changes, and stops idempotently", () => {
    const clock = createFakeClock(1_000);
    const eventSink = sink();
    let wakes = 0;
    const timer = createTimerCoordinator({
      clock,
      getNextDueAt: () => null,
      onWake: () => {
        wakes += 1;
      },
      pollMs: 100,
      events: eventSink,
      instanceId: "instance",
    });
    timer.start();
    timer.start();
    expect(clock.pending).toBe(1);
    clock.advance(99);
    expect(wakes).toBe(0);
    clock.advance(1);
    expect(wakes).toBe(1);
    expect(clock.pending).toBe(1);
    timer.stop();
    timer.stop();
    expect(clock.pending).toBe(0);
    expect(timer.state).toBe("stopped");
    expect(eventSink.events).toContain("scheduler.timer_armed");
    expect(eventSink.events).toContain("scheduler.timer_fired");
  });

  it("chooses the earlier job deadline and clamps long waits", () => {
    const clock = createFakeClock(0, 1_000);
    let wakes = 0;
    const timer = createTimerCoordinator({
      clock,
      getNextDueAt: () => 10_000 as never,
      onWake: () => {
        wakes += 1;
      },
      pollMs: 100_000,
    });
    timer.start();
    clock.advance(999);
    expect(wakes).toBe(0);
    clock.advance(1);
    expect(wakes).toBe(1);
    timer.stop();
  });
});

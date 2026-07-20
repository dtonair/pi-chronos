import { describe, expect, it } from "vitest";
import { createTimerCoordinator } from "../../src/scheduler/timer-coordinator.js";
import { calculateTimerDelay } from "../../src/scheduler/timer-delay.js";
import { createFakeClock } from "../fixtures/fake-clock.js";

describe("acceptance boundaries", () => {
  it("does not overflow the native timer ceiling", () => {
    expect(calculateTimerDelay((60 * 86_400_000) as never, 0 as never, 2_147_000_000)).toBe(
      2_147_000_000,
    );
  });

  it("recalculates after a large wall-clock jump", () => {
    const clock = createFakeClock(0);
    let wakes = 0;
    let nextDue = 60_000 as never;
    const coordinator = createTimerCoordinator({
      clock,
      getNextDueAt: () => nextDue,
      onWake: () => {
        wakes += 1;
        nextDue = null as never;
      },
      pollMs: 10_000,
    });
    coordinator.start();
    clock.setTime(86_400_000);
    expect(wakes).toBe(1);
    coordinator.stop();
  });
});

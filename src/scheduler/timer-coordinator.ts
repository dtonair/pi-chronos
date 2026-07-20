import type { DomainEvent } from "../domain/events.js";
import type { UTCTimestamp } from "../domain/job.js";
import type { Clock, ClockTimer, EventSink } from "../shared/ports.js";
import { calculateTimerDelay } from "./timer-delay.js";

export interface TimerCoordinatorOptions {
  clock: Clock;
  getNextDueAt: () => UTCTimestamp | null;
  onWake: () => void;
  events?: EventSink;
  pollMs?: number;
  instanceId?: string;
}

/** One bounded timer, with serialized wake passes and a cross-process poll. */
export function createTimerCoordinator(options: TimerCoordinatorOptions) {
  let timer: ClockTimer | undefined;
  let stopped = true;
  let waking = false;
  let wakeAgain = false;

  function event(type: DomainEvent["type"], payload?: Record<string, unknown>): void {
    options.events?.emit({
      type,
      timestamp: options.clock.now(),
      instanceId: options.instanceId,
      payload,
    });
  }

  function clear(): void {
    timer?.clear();
    timer = undefined;
    event("scheduler.timer_cleared");
  }

  function wake(): void {
    if (stopped) return;
    if (waking) {
      wakeAgain = true;
      return;
    }
    waking = true;
    event("scheduler.timer_fired");
    try {
      options.onWake();
    } finally {
      waking = false;
      if (wakeAgain) {
        wakeAgain = false;
        arm();
      } else {
        arm();
      }
    }
  }

  function arm(): void {
    if (stopped) return;
    clear();
    const now = options.clock.now();
    const next = options.getNextDueAt();
    const pollTarget = (now + (options.pollMs ?? 30_000)) as UTCTimestamp;
    // Poll even when a known job is scheduled far in the future so another
    // scheduler process can publish an earlier due row without waiting days.
    const target = next === null ? pollTarget : (Math.min(next, pollTarget) as UTCTimestamp);
    const delay = calculateTimerDelay(target, now, options.clock.maxTimeoutMs);
    timer = options.clock.setTimeout(wake, delay);
    event("scheduler.timer_armed", {
      delay,
      nextRunAt: next === null ? undefined : new Date(next).toISOString(),
    });
  }

  function start(): void {
    if (!stopped) return;
    stopped = false;
    arm();
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clear();
  }

  return {
    start,
    stop,
    arm,
    wake,
    get state(): "stopped" | "armed" | "waking" {
      return stopped ? "stopped" : waking ? "waking" : "armed";
    },
  };
}

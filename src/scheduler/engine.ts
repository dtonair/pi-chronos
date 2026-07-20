import type { Clock, EventSink, IdGenerator, Logger } from "../shared/ports.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { initializeNullSchedules } from "../storage/repositories/scheduler-repository.js";
import { createCronCalculator } from "./cron.js";
import { createDispatcher, type DispatcherOptions } from "./dispatcher.js";
import { queryNextDueAt } from "./due-query.js";
import { createExecutionPump, type ExecutionPumpOptions } from "./execution-pump.js";
import { createInstanceCoordinator } from "./instance-coordinator.js";
import { createLeaseCoordinator } from "./lease-coordinator.js";
import { recoverStaleRuns } from "./recovery.js";
import { createTimerCoordinator } from "./timer-coordinator.js";

export interface SchedulerEngineOptions {
  adapter: DatabaseAdapter;
  clock: Clock;
  ids: IdGenerator;
  instanceId: string;
  events?: EventSink;
  logger?: Logger;
  dispatch?: Omit<DispatcherOptions, "adapter" | "clock" | "ids" | "instanceId" | "events">;
  pump?: Omit<ExecutionPumpOptions, "adapter" | "clock" | "instanceId">;
}

/** Compose dispatcher, one timer, and the bounded durable execution pump. */
export function createSchedulerEngine(options: SchedulerEngineOptions) {
  const instance = createInstanceCoordinator({
    adapter: options.adapter,
    clock: options.clock,
    ids: options.ids,
    events: options.events,
    id: options.instanceId,
  });
  const lease = createLeaseCoordinator({
    adapter: options.adapter,
    clock: options.clock,
    ownerId: options.instanceId,
    events: options.events,
  });
  const dispatcher = createDispatcher({
    adapter: options.adapter,
    clock: options.clock,
    ids: options.ids,
    instanceId: options.instanceId,
    events: options.events,
    cronCalc: options.dispatch?.cronCalc ?? createCronCalculator(),
    batchSize: options.dispatch?.batchSize,
  });
  const pump = options.pump
    ? createExecutionPump({
        adapter: options.adapter,
        clock: options.clock,
        instanceId: options.instanceId,
        events: options.events,
        ...options.pump,
      })
    : undefined;
  const timer = createTimerCoordinator({
    clock: options.clock,
    getNextDueAt: () => queryNextDueAt(options.adapter),
    events: options.events,
    instanceId: options.instanceId,
    onWake: () => {
      wake();
    },
  });
  let started = false;
  let waking = false;
  let lastSchedulerError: { code: string; message: string } | undefined;

  function initialize(): void {
    initializeNullSchedules(options.adapter, options.clock.now(), createCronCalculator());
  }

  function wake(): void {
    if (!started || waking) return;
    waking = true;
    options.events?.emit({
      type: "scheduler.wake",
      timestamp: options.clock.now(),
      instanceId: options.instanceId,
    });
    try {
      // Materialize jobs created while this runtime was already active before
      // querying due rows; next_run_at remains durable and authoritative.
      initialize();
      const result = dispatcher.dispatchDue();
      if (!result.ok) {
        lastSchedulerError = { code: result.error.code, message: result.error.message };
        options.events?.emit({
          type: "scheduler.error",
          timestamp: options.clock.now(),
          instanceId: options.instanceId,
          error: `${result.error.code}: ${result.error.message}`,
        });
        options.logger?.error("Scheduler dispatch failed", {
          code: result.error.code,
          message: result.error.message,
        });
      }
      void pump?.wake();
    } finally {
      waking = false;
    }
  }

  function start(): void {
    if (started) return;
    instance.start();
    recoverStaleRuns({
      adapter: options.adapter,
      clock: options.clock,
      ids: options.ids,
      events: options.events,
    });
    initialize();
    started = true;
    lease.start();
    pump?.start();
    timer.start();
    wake();
  }

  async function stop(): Promise<void> {
    if (!started) return;
    started = false;
    timer.stop();
    await pump?.stop();
    lease.stop();
    instance.stop();
  }

  return {
    start,
    stop,
    wake,
    dispatcher,
    timer,
    pump,
    instance,
    lease,
    get running(): boolean {
      return started;
    },
    get lastError(): { code: string; message: string } | undefined {
      return lastSchedulerError;
    },
  };
}

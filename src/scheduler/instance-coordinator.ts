import { hostname } from "node:os";
import type { DomainEvent } from "../domain/events.js";
import type { SchedulerInstance } from "../domain/instance.js";
import type { Clock, ClockTimer, EventSink, IdGenerator } from "../shared/ports.js";
import type { DatabaseAdapter } from "../storage/database.js";
import {
  registerInstance,
  stopInstance,
  updateHeartbeat,
} from "../storage/repositories/instance-repository.js";

export interface InstanceCoordinatorOptions {
  adapter: DatabaseAdapter;
  clock: Clock;
  ids: IdGenerator;
  events?: EventSink;
  heartbeatMs?: number;
  host?: string;
  processId?: number;
  id?: string;
}

/** Owns exactly one durable scheduler instance and one heartbeat timer. */
export function createInstanceCoordinator(options: InstanceCoordinatorOptions) {
  const heartbeatMs = Math.max(1_000, options.heartbeatMs ?? 10_000);
  let instance: SchedulerInstance | undefined;
  let timer: ClockTimer | undefined;
  let stopped = true;

  function emit(type: DomainEvent["type"], payload?: Record<string, unknown>): void {
    if (!instance) return;
    options.events?.emit({
      type,
      timestamp: options.clock.now(),
      instanceId: instance.id,
      payload,
    });
  }

  function heartbeat(): void {
    if (stopped || !instance) return;
    const now = options.clock.now();
    updateHeartbeat(options.adapter, instance.id, now);
    instance.heartbeatAt = now;
    emit("instance.heartbeat");
    timer = options.clock.setTimeout(heartbeat, heartbeatMs);
  }

  function start(): SchedulerInstance {
    if (!instance) {
      const now = options.clock.now();
      instance = {
        id: options.id ?? options.ids.generate(),
        hostname: options.host ?? hostname(),
        processId: options.processId ?? process.pid,
        startedAt: now,
        heartbeatAt: now,
      };
      registerInstance(options.adapter, instance);
      emit("instance.registered");
    }
    stopped = false;
    timer?.clear();
    timer = options.clock.setTimeout(heartbeat, heartbeatMs);
    return instance;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    timer?.clear();
    timer = undefined;
    if (instance && instance.stoppedAt === undefined) {
      const now = options.clock.now();
      stopInstance(options.adapter, instance.id, now);
      instance.stoppedAt = now;
      emit("instance.stopped");
    }
  }

  return {
    start,
    stop,
    heartbeat,
    get instance(): SchedulerInstance | undefined {
      return instance;
    },
    get running(): boolean {
      return !stopped;
    },
  };
}

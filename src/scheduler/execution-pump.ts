import type { UTCTimestamp } from "../domain/job.js";
import type { Run } from "../domain/run.js";
import type { Clock, EventSink } from "../shared/ports.js";
import { decodeRunRow } from "../storage/codecs.js";
import type { DatabaseAdapter } from "../storage/database.js";
import { updateJobRunCounters } from "../storage/repositories/job-repository.js";
import { claimRun, transitionRunStatus } from "../storage/repositories/run-repository.js";
import { listQueuedRuns } from "../storage/repositories/scheduler-repository.js";
import { inImmediateTransaction } from "../storage/transaction.js";

export interface PumpExecutionResult {
  status: "succeeded" | "failed" | "timed_out" | "cancelled";
  message?: string;
  output?: Run["output"];
}

export type RunExecutor = (run: Run, signal: AbortSignal) => Promise<PumpExecutionResult>;

export interface ExecutionPumpOptions {
  adapter: DatabaseAdapter;
  clock: Clock;
  instanceId: string;
  execute: RunExecutor;
  concurrency?: number;
  leaseMs?: number;
  events?: EventSink;
}

/** Bounded worker pump. SQLite's queued rows remain authoritative across restarts. */
export function createExecutionPump(options: ExecutionPumpOptions) {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const leaseMs = Math.max(1_000, options.leaseMs ?? 60_000);
  const active = new Map<string, Promise<void>>();
  const controllers = new Map<string, AbortController>();
  let pumping: Promise<void> | undefined;
  let pumpAgain = false;
  let stopped = true;

  async function process(row: Run): Promise<void> {
    const now = options.clock.now();
    const claimed = claimRun(
      options.adapter,
      row.id,
      options.instanceId,
      (now + leaseMs) as UTCTimestamp,
      now,
    );
    if (!claimed.ok) return;
    const owned = claimed.value;
    options.events?.emit({
      type: "run.claimed",
      timestamp: now,
      instanceId: options.instanceId,
      entityId: owned.jobId,
      entityId2: owned.id,
      status: owned.status,
    });
    const started = transitionRunStatus(
      options.adapter,
      owned.id,
      options.instanceId,
      "running",
      now,
    );
    if (!started.ok) return;
    options.events?.emit({
      type: "run.started",
      timestamp: now,
      instanceId: options.instanceId,
      entityId: started.value.jobId,
      entityId2: started.value.id,
      status: started.value.status,
    });
    const controller = new AbortController();
    controllers.set(row.id, controller);
    let outcome: PumpExecutionResult;
    try {
      outcome = await options.execute(started.value, controller.signal);
    } catch (error) {
      outcome = {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    try {
      // transitionRunStatus checks ownership and terminal immutability. A lost
      // lease therefore cannot overwrite a recovery decision.
      const finished = inImmediateTransaction(options.adapter, () => {
        const transitioned = transitionRunStatus(
          options.adapter,
          row.id,
          options.instanceId,
          outcome.status,
          options.clock.now(),
          { output: outcome.output, error: outcome.message },
        );
        if (!transitioned.ok) return transitioned;
        const counters = updateJobRunCounters(
          options.adapter,
          row.jobId,
          outcome.status === "succeeded",
          options.clock.now(),
        );
        return counters.ok ? transitioned : counters;
      });
      if (finished.ok) {
        options.events?.emit({
          type: "run.finished",
          timestamp: options.clock.now(),
          instanceId: options.instanceId,
          entityId: finished.value.jobId,
          entityId2: finished.value.id,
          status: finished.value.status,
        });
      }
    } finally {
      controllers.delete(row.id);
    }
  }

  async function pumpOnce(): Promise<void> {
    while (!stopped) {
      const capacity = concurrency - active.size;
      if (capacity <= 0) {
        await Promise.all([...active.values()]);
        continue;
      }
      const rows = listQueuedRuns(options.adapter, capacity);
      if (rows.length === 0) return;
      let launched = 0;
      for (const raw of rows) {
        const decoded = decodeRunRow(raw);
        if (!decoded.ok || active.has(decoded.value.id)) continue;
        const promise = process(decoded.value).finally(() => active.delete(decoded.value.id));
        active.set(decoded.value.id, promise);
        launched++;
      }
      if (launched === 0) return;
      await Promise.all([...active.values()]);
    }
  }

  async function runPump(): Promise<void> {
    do {
      pumpAgain = false;
      await pumpOnce();
    } while (pumpAgain && !stopped);
  }

  function pump(): Promise<void> {
    if (pumping !== undefined) {
      // A wake can dispatch durable rows while an earlier scan is finishing.
      // Coalesce that wake into the same promise rather than losing work.
      pumpAgain = true;
      return pumping;
    }
    pumping = runPump().finally(() => {
      pumping = undefined;
      pumpAgain = false;
    });
    return pumping;
  }

  function start(): void {
    stopped = false;
    void pump();
  }
  async function stop(): Promise<void> {
    stopped = true;
    for (const controller of controllers.values()) controller.abort();
    await Promise.all([...active.values()]);
  }
  function cancel(runId: string): boolean {
    const controller = controllers.get(runId);
    if (controller === undefined) return false;
    controller.abort();
    return true;
  }
  function wake(): Promise<void> {
    return pump();
  }

  return {
    start,
    stop,
    wake,
    cancel,
    get activeCount(): number {
      return active.size;
    },
    get running(): boolean {
      return !stopped;
    },
  };
}

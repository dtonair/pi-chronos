import type { DomainEvent } from "../domain/events.js";
import type { Job, UTCTimestamp } from "../domain/job.js";
import type { Run } from "../domain/run.js";
import type { Clock, EventSink, IdGenerator } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { ok } from "../shared/result.js";
import type { DatabaseAdapter } from "../storage/database.js";
import {
  type DispatchResult,
  dispatchOccurrence,
  skipMissedOccurrences,
} from "../storage/repositories/scheduler-repository.js";
import { type CronCalculator, createCronCalculator } from "./cron.js";
import { queryDueJobs } from "./due-query.js";
import { nextIntervalOccurrence, resolveIntervalAnchor } from "./interval.js";
import { calculateMissedRange } from "./missed-run.js";
import { occurrenceKeyFor } from "./occurrence-key.js";
import { hasActiveOverlap } from "./overlap.js";

export interface DispatcherOptions {
  adapter: DatabaseAdapter;
  clock: Clock;
  ids: IdGenerator;
  instanceId: string;
  cronCalc?: CronCalculator;
  events?: EventSink;
  batchSize?: number;
}

export interface DispatchSummary {
  examined: number;
  queued: number;
  skipped: number;
  overlaps: number;
  catchUps: number;
  alreadyDispatched: number;
}

function emit(events: EventSink | undefined, event: DomainEvent): void {
  events?.emit(event);
}

/** Dispatch due jobs without retaining an in-memory queue of authoritative state. */
export function createDispatcher(options: DispatcherOptions) {
  const cronCalc = options.cronCalc ?? createCronCalculator();
  const batchSize = options.batchSize ?? 100;

  function nextAfter(
    job: Job,
    after: UTCTimestamp,
    intervalAnchorReference = after,
  ): Result<UTCTimestamp | null> {
    const schedule = job.definition.schedule;
    if (schedule.kind === "once") return ok(null);
    if (schedule.kind === "interval") {
      // For auto-anchored intervals, retain the persisted due occurrence as
      // the arithmetic anchor while jumping over downtime in O(1).
      const anchor = resolveIntervalAnchor(schedule, intervalAnchorReference);
      return ok(nextIntervalOccurrence(anchor, schedule.everyMs, after).occurrenceMs);
    }
    const result = cronCalc.nextAfter(schedule.expression, schedule.timezone, after, 1);
    if (!result.ok) return result;
    return ok(result.value[0]?.utcMs ?? null);
  }

  function makeRun(job: Job, occurrenceAt: UTCTimestamp, now: UTCTimestamp, key: string): Run {
    return {
      id: options.ids.generate(),
      jobId: job.id,
      occurrenceKey: key,
      occurrenceAt,
      jobRevision: job.revision,
      trigger: "scheduled",
      attempt: 1,
      status: "queued",
      timing: { queuedAt: now },
      events: [{ timestamp: now, status: "queued" }],
    };
  }

  function dispatchJob(job: Job, now: UTCTimestamp): Result<DispatchResult | { kind: "missed" }> {
    const dueAt = job.nextRunAt;
    if (dueAt === null) return ok({ kind: "missed" });

    const isPast = dueAt < now;
    const nextResult = nextAfter(job, isPast ? now : dueAt, dueAt);
    if (!nextResult.ok) return nextResult;
    const nextRunAt = nextResult.value;
    const missed = isPast
      ? calculateMissedRange(
          job.definition.schedule,
          job.definition.execution.missedRunPolicy,
          dueAt,
          now,
          cronCalc,
        )
      : undefined;
    const multipleMissed = missed !== undefined && missed.missedCount > 1;

    // A skip policy deliberately does not create a durable run for past work.
    if (isPast && job.definition.execution.missedRunPolicy === "skip") {
      const advanced = skipMissedOccurrences(
        options.adapter,
        job.id,
        nextRunAt,
        now,
        nextRunAt === null,
        job.revision,
      );
      if (!advanced.ok) return advanced;
      emit(options.events, {
        type: "scheduler.skip",
        timestamp: now,
        instanceId: options.instanceId,
        entityId: job.id,
        payload: { reason: "MISSED_SKIPPED", missedCount: missed?.missedCount ?? 1 },
      });
      return ok({ kind: "missed" });
    }

    let occurrenceAt = dueAt;
    let key = occurrenceKeyFor(job.definition.schedule, new Date(dueAt).toISOString());
    let run = makeRun(job, occurrenceAt, now, key);
    if (multipleMissed && missed !== undefined) {
      occurrenceAt = now;
      key = `catchup:${missed.lastMissedAt}`;
      run = {
        ...makeRun(job, occurrenceAt, now, key),
        catchUpFirst: Date.parse(missed.firstMissedAt) as UTCTimestamp,
        catchUpLast: Date.parse(missed.lastMissedAt) as UTCTimestamp,
        catchUpCount: missed.missedCount,
      };
    }

    const overlap = hasActiveOverlap(options.adapter, job.id);
    const dispatched = dispatchOccurrence(
      options.adapter,
      { job, run, nextRunAt, disableJob: nextRunAt === null },
      now,
      overlap,
    );
    if (!dispatched.ok) return dispatched;
    const result = dispatched.value;
    if (result.kind === "queued") {
      emit(options.events, {
        type: "scheduler.dispatch",
        timestamp: now,
        instanceId: options.instanceId,
        entityId: job.id,
        entityId2: result.run.id,
        status: "queued",
      });
      if (multipleMissed && missed)
        emit(options.events, {
          type: "scheduler.catch_up",
          timestamp: now,
          instanceId: options.instanceId,
          entityId: job.id,
          entityId2: result.run.id,
          catchUpCount: missed.missedCount,
        });
    } else if (result.kind === "overlap") {
      emit(options.events, {
        type: "scheduler.skip",
        timestamp: now,
        instanceId: options.instanceId,
        entityId: job.id,
        entityId2: result.run.id,
        status: "skipped",
        skipReason: "OVERLAP_SKIPPED",
      });
    }
    return ok(result);
  }

  function dispatchDue(now = options.clock.now()): Result<DispatchSummary> {
    const summary: DispatchSummary = {
      examined: 0,
      queued: 0,
      skipped: 0,
      overlaps: 0,
      catchUps: 0,
      alreadyDispatched: 0,
    };
    const jobs = queryDueJobs(options.adapter, now, batchSize);
    for (const job of jobs) {
      summary.examined++;
      const result = dispatchJob(job, now);
      if (!result.ok) return result;
      if (result.value.kind === "queued") {
        summary.queued++;
        if (result.value.run.catchUpCount !== undefined) summary.catchUps++;
      } else if (result.value.kind === "overlap") {
        summary.skipped++;
        summary.overlaps++;
      } else if (result.value.kind === "already_dispatched") {
        summary.alreadyDispatched++;
      } else {
        summary.skipped++;
      }
    }
    emit(options.events, {
      type: "scheduler.queue_depth",
      timestamp: now,
      instanceId: options.instanceId,
      depth: countQueued(options.adapter),
    });
    return ok(summary);
  }

  return { dispatchDue, dispatchJob };
}

function countQueued(adapter: DatabaseAdapter): number {
  return (
    adapter.get<{ count: number }>("SELECT COUNT(*) AS count FROM job_runs WHERE status = 'queued'")
      ?.count ?? 0
  );
}

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createActionRouter } from "../api/action-router.js";
import { createApprovalService } from "../application/approval-service.js";
import { importProjectJobs } from "../application/import-service.js";
import { createJobService } from "../application/job-service.js";
import { createRunService } from "../application/run-service.js";
import type { AuditEventType } from "../domain/audit.js";
import { createExecutor } from "../execution/executor.js";
import { persistAudit } from "../observability/audit.js";
import { rotateLog } from "../observability/log-rotation.js";
import { createJsonlLogger } from "../observability/logger.js";
import { createMetrics } from "../observability/metrics.js";
import { createSchedulerEngine } from "../scheduler/engine.js";
import { createPlatformSandboxAdapter } from "../security/sandbox-adapter.js";
import { createSystemClock } from "../shared/clock.js";
import { createEventBus } from "../shared/event-bus.js";
import { createIdGenerator } from "../shared/ids.js";
import { openDatabase } from "../storage/database.js";
import { createMigrations, type MigrationRecord } from "../storage/migrations.js";
import {
  countActiveJobs,
  countPendingApprovalJobs,
} from "../storage/repositories/job-repository.js";
import { countRunningRuns, countStaleLeases } from "../storage/repositories/run-repository.js";

const RUN_AUDIT_TYPES: Partial<Record<string, AuditEventType>> = {
  "run.claimed": "run.claimed",
  "run.started": "run.started",
};

function auditTypeForRunEvent(
  type: string,
  status: string | undefined,
): AuditEventType | undefined {
  if (type !== "run.finished") return RUN_AUDIT_TYPES[type];
  switch (status) {
    case "succeeded":
      return "run.succeeded";
    case "failed":
      return "run.failed";
    case "timed_out":
      return "run.timed_out";
    case "cancelled":
      return "run.cancelled";
    case "abandoned":
      return "run.abandoned";
    case "skipped":
      return "run.skipped";
    default:
      return undefined;
  }
}

export interface ChronosRuntimeOptions {
  databasePath: string;
  migrationSql: readonly string[];
  model?: string;
  configDirName?: string;
}

export function createChronosRuntime(options: ChronosRuntimeOptions) {
  const clock = createSystemClock();
  const ids = createIdGenerator();
  const events = createEventBus();
  const metrics = createMetrics();
  const logger = createJsonlLogger(join(dirname(options.databasePath), "chronos.log"), clock);
  events.onAny((event) => {
    switch (event.type) {
      case "scheduler.wake":
        metrics.increment("wakes");
        break;
      case "scheduler.dispatch":
        metrics.increment("dispatches");
        metrics.increment("queuedRuns");
        break;
      case "run.finished":
        if (event.status === "succeeded") metrics.increment("succeeded");
        else if (event.status === "failed" || event.status === "timed_out")
          metrics.increment("failed");
        else if (event.status === "skipped") metrics.increment("skipped");
        else if (event.status === "abandoned") metrics.increment("abandoned");
        break;
      case "policy.denied":
        metrics.increment("policyDenials");
        break;
    }
    logger.info(`chronos.${event.type}`, {
      instanceId: event.instanceId,
      entityId: event.entityId,
      entityId2: event.entityId2,
      status: event.status,
      payload: event.payload,
      error: event.error,
    });
  });
  void rotateLog(join(dirname(options.databasePath), "chronos.log"));
  const migrations: readonly MigrationRecord[] = createMigrations([...options.migrationSql]);
  const opened = openDatabase({ path: options.databasePath, create: true }, migrations);
  if (!opened.ok) throw opened.error;
  const adapter = opened.value;
  const sandbox = createPlatformSandboxAdapter();
  events.onAny((event) => {
    const type = auditTypeForRunEvent(event.type, event.status);
    if (type === undefined || event.entityId === undefined) return;
    const persisted = persistAudit(adapter, {
      id: ids.generate(),
      type,
      timestamp: event.timestamp,
      entityId: event.entityId,
      entityId2: event.entityId2,
      actor: event.instanceId ?? "scheduler",
      payload: { ...event.payload, status: event.status },
      message: `Run ${type}`,
    });
    if (!persisted) {
      lastAuditError = {
        message: `Failed to persist audit event for ${event.entityId}`,
        timestamp: clock.now(),
      };
      logger.error("Audit persistence failed", { entityId: event.entityId, type });
    }
  });
  const shared = {
    adapter,
    clock,
    ids,
    defaultModel: options.model ?? "default",
    events,
  };
  const jobs = createJobService(shared);
  const approvals = createApprovalService(shared);
  let requestCancel: ((runId: string) => boolean) | undefined;
  let lastAuditError:
    | { message: string; timestamp: import("../domain/job.js").UTCTimestamp }
    | undefined;
  const runs = createRunService({
    adapter,
    clock,
    ids,
    requestCancel: (runId) => requestCancel?.(runId) === true,
  });
  let wakeEngine: (() => void) | undefined;
  let engine: ReturnType<typeof createSchedulerEngine>;
  const router = createActionRouter({
    jobs,
    approvals,
    runs,
    clock,
    adapter,
    health: () => ({
      databaseState: "ready",
      migrationVersion: adapter.currentVersion,
      timerState: engine?.timer.state ?? "stopped",
      instanceId: engine?.instance.instance?.id,
      heartbeatAt:
        engine?.instance.instance === undefined
          ? undefined
          : new Date(engine.instance.instance.heartbeatAt).toISOString(),
      queueDepth:
        adapter.get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM job_runs WHERE status = 'queued'",
        )?.count ?? 0,
      activeChildren: engine?.pump?.activeCount ?? 0,
      staleLeases: countStaleLeases(adapter, clock.now()),
      activeJobs: countActiveJobs(adapter),
      pendingApprovalJobs: countPendingApprovalJobs(adapter),
      runningRuns: countRunningRuns(adapter),
      metrics: metrics.snapshot(),
      lastSchedulerError:
        engine?.lastError === undefined
          ? undefined
          : {
              code: engine.lastError.code,
              message: engine.lastError.message,
            },
      lastObservabilityError:
        lastAuditError === undefined && logger.lastError === undefined
          ? undefined
          : {
              message:
                lastAuditError?.message ?? logger.lastError?.message ?? "Observability failure",
              timestamp: new Date(
                lastAuditError?.timestamp ?? logger.lastError?.timestamp ?? clock.now(),
              ).toISOString(),
            },
      enforcement: {
        toolAndPathPolicy: "active",
        osSandbox: sandbox.supported ? "active" : "unavailable",
      },
    }),
    onMutation: () => wakeEngine?.(),
    importProject: (cwd, actor, trusted) =>
      importProjectJobs(
        { jobService: jobs, configDirName: options.configDirName ?? ".pi", events },
        cwd,
        actor,
        trusted,
      ),
  });
  const instanceId = ids.generate();
  const executor = createExecutor({
    sandbox,
    guardExtension: fileURLToPath(new URL("../execution/guard-extension.js", import.meta.url)),
    ownerId: instanceId,
    manifestDirectory: join(dirname(options.databasePath), "manifests"),
    artifactDirectory: join(dirname(options.databasePath), "artifacts"),
    getJob: (id) => {
      const result = jobs.getJob(id);
      return result.ok ? result.value : undefined;
    },
  });
  engine = createSchedulerEngine({
    adapter,
    clock,
    ids,
    instanceId,
    events,
    logger,
    pump: { execute: executor, concurrency: 4, leaseMs: 60_000 },
  });
  wakeEngine = engine.wake;
  requestCancel = (runId) => engine.pump?.cancel(runId) ?? false;
  let stopped = false;
  return {
    adapter,
    jobs,
    approvals,
    runs,
    router,
    engine,
    start: () => {
      if (!stopped) engine.start();
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await engine.stop();
      adapter.close();
    },
  };
}

export type ChronosRuntime = ReturnType<typeof createChronosRuntime>;

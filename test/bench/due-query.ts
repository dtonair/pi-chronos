/**
 * Non-gating benchmark harness for due-query evidence.
 *
 * Seeds 10,000 jobs and measures the due-query time.
 * Intended for manual/CI evidence collection, not gating assertions.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { Job, UTCTimestamp } from "../../src/domain/job.js";
import { createDeterministicIdGenerator } from "../../src/shared/ids.js";
import { openDatabase } from "../../src/storage/database.js";
import { createMigrations } from "../../src/storage/migrations.js";
import { createJob, getDueJobs } from "../../src/storage/repositories/job-repository.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATION_SQL = readFileSync(
  join(__dirname, "../../src/storage/schema/001_initial.sql"),
  "utf-8",
);

const ids = createDeterministicIdGenerator("bench-");
const JOB_COUNT = 10_000;

function createBenchJob(index: number, now: UTCTimestamp): Job {
  const offset = index < JOB_COUNT / 2 ? -60_000 : 3600_000; // half past due, half future
  return {
    id: ids.generate(),
    revision: 1,
    schemaVersion: 1,
    definition: {
      name: `bench-job-${index}`,
      tags: [],
      prompt: `Benchmark job ${index}`,
      schedule: { kind: "interval", everyMs: 3600_000 },
      model: "default",
      identity: { scope: "user", scopeKey: "bench-user" },
      execution: {
        mode: "subagent",
        workingDirectory: "/tmp",
        timeoutMs: DEFAULT_CONFIG.defaultTimeoutMs,
        maxOutputBytes: DEFAULT_CONFIG.defaultMaxOutputBytes,
        overlapPolicy: "skip",
        missedRunPolicy: "skip",
        sandboxRequired: false,
        environment: { values: {}, secretNames: [] },
      },
      permissions: {
        tools: ["read"],
        shell: { allowed: false, commands: [] },
        filesystem: { readPaths: [], writePaths: [] },
        network: { allowed: false, domains: [] },
        extensions: { allowedIds: [] },
        secrets: { allowedNames: [] },
      },
      source: "tool",
    },
    status: "active",
    fingerprint: "f".repeat(64),
    approvedFingerprint: "f".repeat(64),
    createdAt: now,
    createdBy: "bench",
    updatedAt: now,
    updatedBy: "bench",
    nextRunAt: (now + offset) as UTCTimestamp,
    consecutiveFailures: 0,
  };
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "chronos-bench-"));
  const dbPath = join(dir, "bench.db");
  const migrations = createMigrations([MIGRATION_SQL]);

  const result = openDatabase({ path: dbPath, create: true }, migrations);
  if (!result.ok) {
    console.error("Failed to open database:", result.error.message);
    process.exit(1);
  }

  const db = result.value;
  const now = Date.now() as UTCTimestamp;

  // Seed 10,000 jobs
  console.time("seed");
  for (let i = 0; i < JOB_COUNT; i++) {
    const job = createBenchJob(i, now);
    createJob(db, job);
  }
  console.timeEnd("seed");

  // Measure due query
  console.time("due-query");
  const dueJobs = getDueJobs(db, now, 100);
  console.timeEnd("due-query");

  console.log(`Due jobs found: ${dueJobs.length}`);
  console.log(`Total jobs: ${JOB_COUNT}`);

  // Measure multiple queries for stability
  const iterations = 10;
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    getDueJobs(db, now, 100);
    times.push(performance.now() - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  console.log(`Due-query avg over ${iterations} iterations: ${avg.toFixed(2)}ms`);
  console.log(`Due-query max: ${max.toFixed(2)}ms`);

  db.close();
  rmSync(dir, { recursive: true, force: true });

  // Report against threshold (non-gating)
  if (avg < 50) {
    console.log("PASS: Average due-query time under 50ms");
  } else {
    console.log(`NOTE: Average due-query time (${avg.toFixed(2)}ms) exceeds 50ms target`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

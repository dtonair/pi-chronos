import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importProjectJobs } from "../../../src/application/import-service.js";
import { createJobService } from "../../../src/application/job-service.js";
import { createSystemClock } from "../../../src/shared/clock.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import { createTestDatabase, type TestDb } from "../../fixtures/database.js";

describe("trusted project import", () => {
  let db: TestDb;
  let root: string;
  beforeEach(async () => {
    db = createTestDatabase();
    root = await mkdtemp(join(tmpdir(), "chronos-import-"));
  });
  afterEach(async () => {
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  it("reconciles stable imported identities and refuses untrusted projects", async () => {
    const config = join(root, CONFIG_DIR_NAME);
    await mkdir(config);
    await writeFile(
      join(config, "chronos.json"),
      JSON.stringify({
        version: 1,
        jobs: [
          {
            key: "daily",
            name: "Daily",
            prompt: "hello",
            model: "model-x",
            schedule: { kind: "interval", everyMs: 60_000 },
          },
        ],
      }),
    );
    const jobService = createJobService({
      adapter: db.adapter,
      clock: createSystemClock(),
      ids: createDeterministicIdGenerator("imp-"),
      defaultModel: "default",
    });
    const options = { jobService, configDirName: CONFIG_DIR_NAME };
    const denied = await importProjectJobs(options, root, "alice", false);
    expect(denied.ok).toBe(false);
    const first = await importProjectJobs(options, root, "alice", true);
    expect(first.ok && first.value.created).toBe(1);
    const second = await importProjectJobs(options, root, "alice", true);
    expect(second.ok && second.value.created).toBe(0);
    expect(second.ok && second.value.unchanged).toBe(1);
  });

  it("invalidates changed imports and disables missing source definitions", async () => {
    const config = join(root, CONFIG_DIR_NAME);
    await mkdir(config);
    const file = join(config, "chronos.json");
    const definition = {
      key: "stable",
      name: "Stable",
      prompt: "old prompt",
      model: "model-x",
      schedule: { kind: "interval", everyMs: 60_000 },
    };
    await writeFile(file, JSON.stringify({ version: 1, jobs: [definition] }));
    const jobService = createJobService({
      adapter: db.adapter,
      clock: createSystemClock(),
      ids: createDeterministicIdGenerator("reconcile-"),
      defaultModel: "default",
    });
    const options = { jobService, configDirName: CONFIG_DIR_NAME };
    const first = await importProjectJobs(options, root, "alice", true);
    expect(first.ok && first.value.created).toBe(1);
    const stableId = first.ok ? first.value.jobs[0] : undefined;
    await writeFile(
      file,
      JSON.stringify({ version: 1, jobs: [{ ...definition, prompt: "new prompt" }] }),
    );
    const changed = await importProjectJobs(options, root, "alice", true);
    expect(changed.ok && changed.value.updated).toBe(1);
    expect(changed.ok && Object.keys(changed.value.diffs).length).toBe(1);
    expect(stableId).toBe(changed.ok ? changed.value.jobs[0] : undefined);
    if (stableId) expect(jobService.getJob(stableId).ok).toBe(true);
    await writeFile(file, JSON.stringify({ version: 1, jobs: [] }));
    const missing = await importProjectJobs(options, root, "alice", true);
    expect(missing.ok && missing.value.disabled).toBe(1);
    if (stableId) {
      const disabled = jobService.getJob(stableId);
      expect(disabled.ok && disabled.value?.status).toBe("disabled");
    }
  });

  it("disables prior imports when the trusted source file disappears", async () => {
    const config = join(root, CONFIG_DIR_NAME);
    await mkdir(config);
    const file = join(config, "chronos.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        jobs: [
          {
            key: "disappearing",
            name: "Disappearing",
            prompt: "work",
            model: "model-x",
            schedule: { kind: "interval", everyMs: 60_000 },
          },
        ],
      }),
    );
    const jobService = createJobService({
      adapter: db.adapter,
      clock: createSystemClock(),
      ids: createDeterministicIdGenerator("missing-source-"),
      defaultModel: "default",
    });
    const options = { jobService, configDirName: CONFIG_DIR_NAME };
    const imported = await importProjectJobs(options, root, "alice", true);
    expect(imported.ok).toBe(true);
    await rm(file);
    const missing = await importProjectJobs(options, root, "alice", true);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("IMPORT_SOURCE_MISSING");
    expect(
      db.adapter.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM jobs WHERE source = 'project_import' AND status = 'disabled'",
      )?.count,
    ).toBe(1);
  });

  it("rolls back the complete file when a later definition conflicts", async () => {
    const config = join(root, CONFIG_DIR_NAME);
    await mkdir(config);
    await writeFile(
      join(config, "chronos.json"),
      JSON.stringify({
        version: 1,
        jobs: [
          {
            key: "first",
            name: "same-name",
            prompt: "first",
            model: "model-x",
            schedule: { kind: "interval", everyMs: 60_000 },
          },
          {
            key: "second",
            name: "SAME-NAME",
            prompt: "second",
            model: "model-x",
            schedule: { kind: "interval", everyMs: 60_000 },
          },
        ],
      }),
    );
    const jobService = createJobService({
      adapter: db.adapter,
      clock: createSystemClock(),
      ids: createDeterministicIdGenerator("rollback-"),
      defaultModel: "default",
    });
    const result = await importProjectJobs(
      { jobService, configDirName: CONFIG_DIR_NAME },
      root,
      "alice",
      true,
    );
    expect(result.ok).toBe(false);
    expect(
      db.adapter.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM jobs WHERE source = 'project_import'",
      )?.count,
    ).toBe(0);
  });

  it("rejects oversized files and job lists before reconciliation", async () => {
    const config = join(root, CONFIG_DIR_NAME);
    await mkdir(config);
    const file = join(config, "chronos.json");
    await writeFile(file, `${JSON.stringify({ version: 1, jobs: [] })}${"x".repeat(100)}`);
    const jobService = createJobService({
      adapter: db.adapter,
      clock: createSystemClock(),
      ids: createDeterministicIdGenerator("oversized-"),
      defaultModel: "default",
    });
    const result = await importProjectJobs(
      { jobService, configDirName: CONFIG_DIR_NAME, maxBytes: 20 },
      root,
      "alice",
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OVERSIZED_INPUT");
  });
});

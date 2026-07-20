import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionRouter } from "../../../src/api/action-router.js";
import { createApprovalService } from "../../../src/application/approval-service.js";
import { createJobService } from "../../../src/application/job-service.js";
import { createRunService } from "../../../src/application/run-service.js";
import { createDeterministicIdGenerator } from "../../../src/shared/ids.js";
import { ok } from "../../../src/shared/result.js";
import { createTestDatabase, type TestDb } from "../../fixtures/database.js";
import { createFakeClock } from "../../fixtures/fake-clock.js";

const now = 1_700_000_000_000 as never;

describe("scheduler action router contract", () => {
  let db: TestDb;
  let router: ReturnType<typeof createActionRouter>;
  beforeEach(() => {
    db = createTestDatabase();
    const clock = createFakeClock(now);
    const ids = createDeterministicIdGenerator("router-");
    const shared = { adapter: db.adapter, clock, ids, defaultModel: "model-default" };
    const jobs = createJobService(shared);
    const approvals = createApprovalService(shared);
    const runs = createRunService({ adapter: db.adapter, clock, ids, requestCancel: () => true });
    router = createActionRouter({
      jobs,
      approvals,
      runs,
      clock,
      adapter: db.adapter,
      health: () => ({ databaseState: "ready" }),
      importProject: async () => ok({ imported: true }),
    });
  });
  afterEach(() => db.close());

  it("routes preview, CRUD, manual runs, history, and health as structured results", async () => {
    expect(
      (
        await router.route(
          { action: "preview", schedule: { kind: "interval", everyMs: 60_000 } },
          "alice",
          "json",
        )
      ).ok,
    ).toBe(true);
    const created = await router.route(
      {
        action: "create",
        name: "Router Job",
        prompt: "hello",
        schedule: { kind: "interval", everyMs: 60_000 },
      },
      "alice",
      "json",
      { source: "direct_user" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data as { id: string; revision: number };

    expect((await router.route({ action: "get", jobId: job.id }, "alice", "json")).ok).toBe(true);
    expect((await router.route({ action: "list", scope: "user" }, "alice", "json")).ok).toBe(true);
    const updated = await router.route(
      {
        action: "update",
        jobId: job.id,
        expectedRevision: job.revision,
        patch: { description: "shown" },
      },
      "alice",
      "json",
    );
    expect(updated.ok).toBe(true);
    const updatedJob = updated.ok ? (updated.data as { revision: number }) : job;
    const pauseResult = await router.route(
      { action: "pause", jobId: job.id, expectedRevision: updatedJob.revision },
      "alice",
      "json",
    );
    expect(pauseResult.ok).toBe(true);
    const paused = await router.route({ action: "resume", jobId: job.id }, "alice", "json");
    expect(paused.ok).toBe(true);
    expect((await router.route({ action: "run_now", jobId: job.id }, "alice", "json")).ok).toBe(
      true,
    );
    const history = await router.route({ action: "history", jobId: job.id }, "alice", "json");
    expect(history.ok).toBe(true);
    if (history.ok) {
      const run = (history.data as { runs: Array<{ id: string }> }).runs[0];
      expect(
        (await router.route({ action: "cancel_run", runId: run?.id }, "alice", "json")).ok,
      ).toBe(true);
    }
    const currentRevision = paused.ok
      ? (paused.data as { revision: number }).revision
      : updatedJob.revision;
    const archived = await router.route(
      { action: "archive", jobId: job.id, expectedRevision: currentRevision },
      "alice",
      "json",
    );
    expect(archived.ok).toBe(true);
    if (archived.ok) {
      expect(
        (
          await router.route(
            {
              action: "delete",
              jobId: job.id,
              expectedRevision: (archived.data as { revision: number }).revision,
            },
            "alice",
            "json",
          )
        ).ok,
      ).toBe(true);
    }
    const health = await router.route({ action: "health" }, "alice", "json");
    expect(health).toEqual({ ok: true, data: { databaseState: "ready" } });
  });

  it("enforces interactive approval and import context boundaries", async () => {
    const created = await router.route(
      {
        action: "create",
        name: "Tool Job",
        prompt: "hello",
        schedule: { kind: "interval", everyMs: 60_000 },
      },
      "alice",
      "json",
      { source: "tool" },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data as { id: string; fingerprint: string };
    const printApproval = await router.route({ action: "approve", jobId: job.id }, "alice", "json");
    expect(!printApproval.ok && printApproval.error.code).toBe("INTERACTIVE_APPROVAL_REQUIRED");
    const approved = await router.route(
      {
        action: "approve",
        jobId: job.id,
        fingerprint: job.fingerprint,
        confirmationToken: "confirmed",
      },
      "alice",
      "tui",
    );
    expect(approved.ok).toBe(true);
    const rpcCreated = await router.route(
      {
        action: "create",
        name: "RPC Tool Job",
        prompt: "hello",
        schedule: { kind: "interval", everyMs: 60_000 },
      },
      "alice",
      "rpc",
      { source: "tool" },
    );
    expect(rpcCreated.ok).toBe(true);
    if (rpcCreated.ok) {
      const rpcJob = rpcCreated.data as { id: string; fingerprint: string };
      expect(
        (
          await router.route(
            {
              action: "approve",
              jobId: rpcJob.id,
              fingerprint: rpcJob.fingerprint,
              confirmationToken: "rpc-confirmed",
            },
            "alice",
            "rpc",
          )
        ).ok,
      ).toBe(true);
    }
    const revoke = await router.route(
      { action: "revoke_approval", jobId: job.id },
      "alice",
      "print",
    );
    expect(!revoke.ok && revoke.error.code).toBe("INTERACTIVE_APPROVAL_REQUIRED");
    expect((await router.route({ action: "import" }, "alice", "json")).ok).toBe(false);
    expect(
      (
        await router.route({ action: "import" }, "alice", "json", {
          cwd: "/tmp",
          trustedProject: true,
        })
      ).ok,
    ).toBe(true);
    expect((await router.route({ action: "not-real" }, "alice", "json")).ok).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { ChronosError, ChronosErrorCode } from "../../../src/domain/errors.js";
import { err, ok } from "../../../src/shared/result.js";
import type { DatabaseAdapter } from "../../../src/storage/database.js";
import { inImmediateTransaction, inTransaction } from "../../../src/storage/transaction.js";

function fake(overrides: Partial<DatabaseAdapter> = {}): DatabaseAdapter {
  return {
    db: {} as never,
    path: ":memory:",
    permissionSemantics: "enforced",
    currentVersion: 1,
    migrations: [],
    all: () => [],
    get: () => undefined,
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    exec: () => undefined,
    begin: () => undefined,
    beginImmediate: () => undefined,
    commit: () => undefined,
    rollback: () => undefined,
    close: () => undefined,
    ...overrides,
  };
}

describe("transaction boundaries", () => {
  it("commits success and rolls back typed failures", () => {
    let commits = 0;
    let rollbacks = 0;
    const adapter = fake({ commit: () => commits++, rollback: () => rollbacks++ });
    const success = inTransaction(adapter, () => ok("value"));
    expect(success.ok && success.value).toBe("value");
    expect(
      inTransaction(adapter, () =>
        err(new ChronosError({ code: ChronosErrorCode.JOB_NOT_FOUND, message: "missing" })),
      ).ok,
    ).toBe(false);
    expect(commits).toBe(1);
    expect(rollbacks).toBe(1);
  });

  it("maps begin locks and callback exceptions to stable errors", () => {
    const locked = inTransaction(
      fake({
        begin: () => {
          throw new Error("database is locked");
        },
      }),
      () => ok(undefined),
    );
    expect(!locked.ok && locked.error.code).toBe(ChronosErrorCode.DB_LOCKED);
    let rolledBack = false;
    const failed = inImmediateTransaction(
      fake({
        rollback: () => {
          rolledBack = true;
        },
      }),
      () => {
        throw new Error("callback failed");
      },
    );
    expect(!failed.ok && failed.error.code).toBe(ChronosErrorCode.INTERNAL_ERROR);
    expect(rolledBack).toBe(true);
  });

  it("handles deferred callback and rollback failures", () => {
    const deferred = inTransaction(
      fake({
        rollback: () => {
          throw new Error("rollback failed");
        },
      }),
      () => {
        throw new Error("deferred callback failed");
      },
    );
    expect(!deferred.ok && deferred.error.code).toBe(ChronosErrorCode.INTERNAL_ERROR);
    const beginFailure = inTransaction(
      fake({
        begin: () => {
          throw new Error("begin failed");
        },
      }),
      () => ok(undefined),
    );
    expect(!beginFailure.ok && beginFailure.error.code).toBe(ChronosErrorCode.DATABASE_ERROR);
    const immediateBegin = inImmediateTransaction(
      fake({
        beginImmediate: () => {
          throw new Error("database is busy");
        },
      }),
      () => ok(undefined),
    );
    expect(!immediateBegin.ok && immediateBegin.error.code).toBe(ChronosErrorCode.DB_LOCKED);
  });

  it("handles immediate transaction commit failures", () => {
    const result = inImmediateTransaction(
      fake({
        commit: () => {
          throw new Error("commit failed");
        },
      }),
      () => ok(undefined),
    );
    expect(!result.ok && result.error.code).toBe(ChronosErrorCode.INTERNAL_ERROR);
  });
});

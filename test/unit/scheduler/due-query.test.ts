import { describe, expect, it } from "vitest";
import { queryDueJobs, queryNextDueAt } from "../../../src/scheduler/due-query.js";
import type { DatabaseAdapter } from "../../../src/storage/database.js";

function adapter(row: unknown): DatabaseAdapter {
  return {
    db: {} as never,
    path: ":memory:",
    permissionSemantics: "enforced",
    currentVersion: 1,
    migrations: [],
    all: () => [],
    get: <T>() => row as T | undefined,
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    exec: () => undefined,
    begin: () => undefined,
    beginImmediate: () => undefined,
    commit: () => undefined,
    rollback: () => undefined,
    close: () => undefined,
  };
}

describe("due-query bounds", () => {
  it("rejects invalid batch sizes and invalid/missing due timestamps", () => {
    expect(queryDueJobs(adapter(undefined), 0 as never, 0)).toEqual([]);
    expect(queryDueJobs(adapter(undefined), 0 as never, 1.5)).toEqual([]);
    expect(queryNextDueAt(adapter(undefined))).toBeNull();
    expect(queryNextDueAt(adapter({ next_run_at: "not-a-date" }))).toBeNull();
  });

  it("returns a parsed UTC due timestamp", () => {
    const value = queryNextDueAt(adapter({ next_run_at: "2026-01-01T00:00:00.000Z" }));
    expect(value).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });
});

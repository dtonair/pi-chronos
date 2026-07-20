import { describe, expect, it } from "vitest";
import { createMigrations, loadMigrations } from "../../../src/storage/migrations.js";

function migrationDb(overrides: Record<string, unknown> = {}): unknown {
  return {
    prepare: () => ({ all: () => [], get: () => ({ version: null }), run: () => undefined }),
    exec: () => undefined,
    ...overrides,
  };
}

describe("migration fault boundaries", () => {
  it("maps schema read failures and checksum/unknown records", () => {
    const readFailure = loadMigrations(
      migrationDb({
        prepare: () => {
          throw new Error("read failed");
        },
      }) as never,
      [],
    );
    expect(!readFailure.ok && readFailure.error.code).toBe("MIGRATION_ERROR");
    const unknown = loadMigrations(
      migrationDb({ prepare: () => ({ all: () => [{ version: 99, checksum: "x" }] }) }) as never,
      [],
    );
    expect(!unknown.ok && unknown.error.code).toBe("MIGRATION_ERROR");
    const migration = createMigrations(["CREATE TABLE test (id INTEGER)"]);
    const mismatch = loadMigrations(
      migrationDb({ prepare: () => ({ all: () => [{ version: 1, checksum: "wrong" }] }) }) as never,
      migration,
    );
    expect(!mismatch.ok && mismatch.error.code).toBe("MIGRATION_ERROR");
  });

  it("rolls back a migration failure and preserves a diagnostic error", () => {
    let execCalls = 0;
    const db = migrationDb({
      exec: (sql: string) => {
        execCalls++;
        if (sql.includes("CREATE TABLE")) throw new Error("migration syntax");
        if (sql === "ROLLBACK") throw new Error("rollback failed");
      },
    });
    const result = loadMigrations(
      db as never,
      createMigrations(["CREATE TABLE broken (id INTEGER)"]),
    );
    expect(!result.ok && result.error.code).toBe("MIGRATION_ERROR");
    expect(execCalls).toBeGreaterThan(0);
  });
});

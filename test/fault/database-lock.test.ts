import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/storage/database.js";
import { createMigrations } from "../../src/storage/migrations.js";
import { createTestDatabase } from "../fixtures/database.js";

const schema = `
  CREATE TABLE jobs (id TEXT PRIMARY KEY);
`;

describe("database fault injection", () => {
  const cleanup: string[] = [];
  afterEach(() => {
    for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it("does not silently proceed when an immediate transaction is locked", () => {
    const dir = mkdtempSync(join(tmpdir(), "chronos-lock-"));
    cleanup.push(dir);
    const path = join(dir, "chronos.db");
    const migrations = createMigrations([schema]);
    const first = openDatabase({ path, create: true }, migrations);
    const second = openDatabase({ path, create: true }, migrations);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    try {
      first.value.beginImmediate();
      second.value.exec("PRAGMA busy_timeout = 10");
      expect(() => second.value.beginImmediate()).toThrow();
    } finally {
      try {
        first.value.rollback();
      } catch {
        // The assertion above is the fault boundary; cleanup remains best effort.
      }
      first.value.close();
      second.value.close();
    }
  });

  it("keeps test database fixtures isolated and usable after a failed operation", () => {
    const db = createTestDatabase();
    expect(() => db.adapter.run("INSERT INTO missing_table VALUES (1)")).toThrow();
    expect(db.adapter.get<{ user_version: number }>("PRAGMA user_version")).toBeDefined();
    db.close();
  });
});

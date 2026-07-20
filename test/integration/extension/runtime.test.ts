import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createChronosRuntime } from "../../../src/extension/runtime.js";
import { createTestDatabase } from "../../fixtures/database.js";

const schema = readFileSync(
  new URL("../../../src/storage/schema/001_initial.sql", import.meta.url),
  "utf8",
);

describe("composed runtime", () => {
  it("refuses to compose a runtime when migrations fail", () => {
    const fresh = createTestDatabase();
    expect(() =>
      createChronosRuntime({
        databasePath: `${fresh.dir}/failed.db`,
        migrationSql: ["CREATE TABLE jobs (id TEXT); INVALID SQL"],
      }),
    ).toThrow(/migration|schema/i);
    fresh.close();
  });

  it("starts and stops one durable runtime without duplicate resources", async () => {
    const fresh = createTestDatabase();
    const runtime = createChronosRuntime({
      databasePath: `${fresh.dir}/runtime.db`,
      migrationSql: [schema],
    });
    runtime.start();
    runtime.start();
    expect(runtime.engine.running).toBe(true);
    const health = await runtime.router.route({ action: "health" }, "test", "json");
    expect(health.ok).toBe(true);
    if (health.ok) expect((health.data as { metrics?: unknown }).metrics).toBeDefined();
    await runtime.stop();
    await runtime.stop();
    expect(runtime.engine.running).toBe(false);
    fresh.close();
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChronosErrorCode } from "../../../src/domain/errors.js";
import { createJob, getJobById } from "../../../src/storage/repositories/job-repository.js";
import { createTestDatabase, createTestJob, type TestDb } from "../../fixtures/database.js";

describe("record-level corrupt row diagnostics", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it("returns DB_CORRUPT_ROW for malformed embedded schedule JSON", () => {
    const job = createTestJob({ id: "job-corrupt" });
    expect(createJob(db.adapter, job).ok).toBe(true);
    db.adapter.run("UPDATE jobs SET schedule_json = ? WHERE id = ?", "{broken", job.id);
    const result = getJobById(db.adapter, job.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ChronosErrorCode.DB_CORRUPT_ROW);
  });

  it("returns DB_CORRUPT_ROW for semantically invalid persisted permissions", () => {
    const job = createTestJob({ id: "job-bad-permissions" });
    expect(createJob(db.adapter, job).ok).toBe(true);
    db.adapter.run(
      "UPDATE jobs SET permissions_json = ? WHERE id = ?",
      JSON.stringify({ schemaVersion: 1, value: { tools: ["read"] } }),
      job.id,
    );
    const result = getJobById(db.adapter, job.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(ChronosErrorCode.DB_CORRUPT_ROW);
  });
});

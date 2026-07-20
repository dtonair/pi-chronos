import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../../../src/domain/audit.js";
import {
  appendAuditEvents,
  listAuditEvents,
} from "../../../src/storage/repositories/audit-repository.js";
import { createTestDatabase, type TestDb } from "../../fixtures/database.js";

describe("audit keyset pagination", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDatabase();
  });
  afterEach(() => db.close());

  it("preserves same-timestamp events across pages", () => {
    const timestamp = new Date(1_700_000_000_000).toISOString();
    const events: AuditEvent[] = ["a", "b", "c"].map((id) => ({
      id,
      type: "job.created",
      timestamp: timestamp as never,
      entityId: `job-${id}`,
      actor: "test",
      payload: {},
      message: id,
    }));
    expect(appendAuditEvents(db.adapter, events).ok).toBe(true);

    const first = listAuditEvents(db.adapter, { limit: 2 });
    expect(first.events.map((event) => event.id)).toEqual(["a", "b"]);
    expect(first.nextCursor).toBeDefined();
    const second = listAuditEvents(db.adapter, { cursor: first.nextCursor, limit: 2 });
    expect(second.events.map((event) => event.id)).toEqual(["c"]);
    expect(second.nextCursor).toBeUndefined();
  });
});

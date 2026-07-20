import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../../../src/domain/audit.js";
import {
  decodeApprovalRow,
  decodeAuditRow,
  decodeInstanceRow,
  decodeJobRow,
  decodeRunRow,
  encodeApprovalRow,
  encodeAuditRow,
  encodeInstanceRow,
  encodeJobRow,
  encodeRunRow,
} from "../../../src/storage/codecs.js";
import { createTestApproval, createTestJob, createTestRun } from "../../fixtures/database.js";

const time = 1_700_000_000_000 as never;

describe("storage row codecs", () => {
  it("round-trips jobs and rejects malformed embedded records", () => {
    const row = encodeJobRow(createTestJob({ id: "codec-job" }));
    expect(decodeJobRow(row).ok).toBe(true);
    expect(!decodeJobRow({ ...row, created_at: "bad" }).ok).toBe(true);
    expect(!decodeJobRow({ ...row, tags_json: "{}" }).ok).toBe(true);
    expect(
      !decodeJobRow({
        ...row,
        schedule_json: JSON.stringify({ schemaVersion: 1, value: { kind: "once" } }),
      }).ok,
    ).toBe(true);
    expect(!decodeJobRow({ ...row, execution_json: "{}" }).ok).toBe(true);
    expect(!decodeJobRow({ ...row, permissions_json: "{}" }).ok).toBe(true);
  });

  it("round-trips rich run metadata and rejects bad timestamps/metadata", () => {
    const run = createTestRun({
      id: "codec-run",
      output: {
        summary: "summary",
        truncated: true,
        totalBytes: 12,
        stopReason: "done",
        toolActivity: ["read"],
      },
      catchUpFirst: time,
      catchUpLast: (time + 1_000) as never,
      catchUpCount: 2,
    });
    const row = encodeRunRow(run);
    const decoded = decodeRunRow(row);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.output?.toolActivity).toEqual(["read"]);
      expect(decoded.value.catchUpCount).toBe(2);
    }
    expect(!decodeRunRow({ ...row, queued_at: "bad" }).ok).toBe(true);
    expect(!decodeRunRow({ ...row, metadata_json: "{" }).ok).toBe(true);
  });

  it("round-trips approval/instance rows and preserves malformed audit payloads", () => {
    const approval = createTestApproval({ id: "codec-approval" });
    expect(decodeApprovalRow(encodeApprovalRow(approval)).fingerprint).toBe(approval.fingerprint);
    const instance = {
      id: "codec-instance",
      hostname: "host",
      processId: 42,
      startedAt: time,
      heartbeatAt: time,
    };
    expect(decodeInstanceRow(encodeInstanceRow(instance)).processId).toBe(42);
    const event: AuditEvent = {
      id: "codec-audit",
      type: "job.created",
      timestamp: time,
      entityId: "job",
      actor: "test",
      payload: { key: "value" },
      message: "created",
    };
    expect(decodeAuditRow(encodeAuditRow(event)).payload).toEqual({ key: "value" });
    expect(decodeAuditRow({ ...encodeAuditRow(event), details_json: "not-json" }).payload).toEqual({
      raw: "not-json",
    });
  });
});

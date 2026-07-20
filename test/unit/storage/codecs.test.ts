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
    const rich = createTestJob({ id: "codec-job" });
    rich.definition.permissions = {
      ...rich.definition.permissions,
      process: {
        allowed: true,
        commands: [
          {
            executable: "fake-cli",
            args: [
              { kind: "literal", value: "list" },
              { kind: "slot", name: "id", valueType: "uuid" },
            ],
          },
        ],
      },
    };
    rich.definition.execution.completion = {
      mode: "explicit",
      requiredOutputs: [{ path: "report.md", mutation: "atomic_replace" }],
    };
    const row = encodeJobRow(rich);
    expect(decodeJobRow(row).ok).toBe(true);
    const legacyPermissions = JSON.parse(row.permissions_json) as {
      value: Record<string, unknown>;
    };
    delete legacyPermissions.value.process;
    const legacyExecution = JSON.parse(row.execution_json) as Record<string, unknown>;
    delete legacyExecution.completion;
    const legacy = decodeJobRow({
      ...row,
      permissions_json: JSON.stringify(legacyPermissions),
      execution_json: JSON.stringify(legacyExecution),
    });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.value.definition.permissions.process?.allowed).toBe(false);
      expect(legacy.value.definition.execution.completion).toEqual({ mode: "process_exit" });
    }
    expect(
      !decodeJobRow({
        ...row,
        permissions_json: JSON.stringify({
          schemaVersion: 1,
          value: { ...JSON.parse(row.permissions_json).value, unknown: true },
        }),
      }).ok,
    ).toBe(true);
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
        completionSummary: "completed",
        completionCategory: "command_failure",
        toolErrorCount: 1,
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
      expect(decoded.value.output?.completionSummary).toBe("completed");
      expect(decoded.value.output?.completionCategory).toBe("command_failure");
      expect(decoded.value.output?.toolErrorCount).toBe(1);
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

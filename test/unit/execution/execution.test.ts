import { describe, expect, it } from "vitest";
import { createExecutor } from "../../../src/execution/executor.js";
import { JsonlParser } from "../../../src/execution/jsonl-parser.js";
import { limitOutput } from "../../../src/execution/output-limiter.js";
import { buildPiInvocation, findPiExecutable } from "../../../src/execution/pi-invocation.js";
import { redactText } from "../../../src/execution/redactor.js";

describe("child execution adapters", () => {
  it("returns a durable failure when the job disappears before execution", async () => {
    const executor = createExecutor({
      guardExtension: "/tmp/guard.js",
      getJob: () => undefined,
    });
    const result = await executor(
      {
        id: "run-missing",
        jobId: "missing",
        occurrenceKey: "manual:missing",
        occurrenceAt: 1_700_000_000_000 as never,
        jobRevision: 1,
        trigger: "manual",
        attempt: 1,
        status: "running",
        timing: { queuedAt: 1_700_000_000_000 as never },
        events: [],
      },
      new AbortController().signal,
    );
    expect(result).toEqual({ status: "failed", message: "Job was deleted before execution" });
  });

  it("parses split JSONL and bounds malformed diagnostics", () => {
    const parser = new JsonlParser(1);
    parser.push('{"type":"assistant","text":"hel');
    parser.push('lo"}\n{"type":"tool_call","name":"read"}\nnot-json\n');
    parser.push('{"type":"assistant","usage":{"input_tokens":2,"output_tokens":3}}');
    const result = parser.finish();
    expect(result.assistantText).toBe("hello");
    expect(result.toolActivity).toEqual(["read"]);
    expect(result.inputTokens).toBe(2);
    expect(result.malformedLines).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("drops oversized JSONL lines and preserves bounded UTF-8 output", () => {
    const parser = new JsonlParser(2, 4, 100);
    parser.push(`${"x".repeat(120)}\n`);
    parser.push('{"type":"message_end","message":{"stopReason":"done"}}');
    const result = parser.finish();
    expect(result.malformedLines).toBe(1);
    expect(result.stopReason).toBe("done");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps prompts out of argv and uses explicit child restrictions", () => {
    const invocation = buildPiInvocation({
      model: "provider/model",
      tools: ["read"],
      guardExtension: "/tmp/guard.js",
    });
    expect(invocation.args).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--model",
      "provider/model",
      "--tools",
      "read",
      "--no-extensions",
      "--extension",
      "/tmp/guard.js",
    ]);
    expect(invocation.args).not.toContain("secret prompt");
    expect(
      findPiExecutable({ PATH: "/does-not-exist" }, ["node", "/tmp/not-pi.js"]),
    ).toBeUndefined();
  });

  it("redacts secrets and fails closed when redaction cannot remove a value", () => {
    const redacted = redactText("token=abc", ["abc"]);
    expect(redacted.ok && redacted.value).toBe("token=[REDACTED]");
    const failed = redactText("[REDACTED]", ["[REDACTED]"]);
    expect(!failed.ok && failed.error.code).toBe("SECRET_REDACTION_FAILED");
    expect(limitOutput(["12345"], 3).truncated).toBe(true);
  });
});

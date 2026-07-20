import { describe, expect, it } from "vitest";
import { JsonlParser } from "../../../src/execution/jsonl-parser.js";
import { limitOutput } from "../../../src/execution/output-limiter.js";

describe("bounded child output", () => {
  it("handles a partial final JSONL record and truncates output", () => {
    const parser = new JsonlParser();
    parser.push('{"type":"assistant","text":"done"}');
    expect(parser.finish().assistantText).toBe("done");
    expect(limitOutput(["0123456789"], 4).text).toContain("output truncated");
  });
});

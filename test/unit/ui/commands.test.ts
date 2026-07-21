import { describe, expect, it } from "vitest";
import {
  buildNaturalChronosPrompt,
  isNaturalChronosRequest,
  parseChronosCommand,
} from "../../../src/ui/commands.js";

describe("/chronos command parser", () => {
  it("supports empty, human, JSON, and option forms", () => {
    expect(parseChronosCommand("")).toEqual({ action: "list" });
    expect(parseChronosCommand("status")).toEqual({ action: "health" });
    expect(parseChronosCommand("show job-1")).toEqual({ action: "get", jobId: "job-1" });
    expect(parseChronosCommand("cancel run-1")).toEqual({ action: "cancel_run", runId: "run-1" });
    expect(parseChronosCommand('list {"limit":5}')).toEqual({ action: "list", limit: 5 });
    expect(parseChronosCommand('{"action":"health"}')).toEqual({ action: "health" });
  });

  it("rejects unknown, malformed, and non-object option forms", () => {
    expect(parseChronosCommand("unknown")).toBeUndefined();
    expect(parseChronosCommand("list {")).toBeUndefined();
    expect(parseChronosCommand("list []")).toBeUndefined();
    expect(parseChronosCommand("{bad")).toBeUndefined();
  });

  it("distinguishes natural requests from malformed direct commands", () => {
    const request = "check pipeline status every 5 min and write pipeline-status.md";
    const createRequest =
      "create PR to develop and check bitbucket pipeline status every 5 minutes and write it to ./pipeline-status.md";
    expect(isNaturalChronosRequest(request)).toBe(true);
    expect(isNaturalChronosRequest(createRequest)).toBe(true);
    expect(isNaturalChronosRequest("status")).toBe(false);
    expect(isNaturalChronosRequest("list {")).toBe(false);
    expect(isNaturalChronosRequest("list []")).toBe(false);
    expect(isNaturalChronosRequest("{bad")).toBe(false);
    expect(buildNaturalChronosPrompt(request)).toContain(`Scheduling request: ${request}`);
  });
});

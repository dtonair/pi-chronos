import { describe, expect, it } from "vitest";
import { reduceTerminalOutcome } from "../../../src/execution/outcome.js";

describe("terminal outcome reducer", () => {
  it("retains legacy process-exit semantics", () => {
    expect(
      reduceTerminalOutcome({
        completion: { mode: "process_exit" },
        exitCode: 0,
        protocolFailure: true,
      }),
    ).toEqual({ status: "succeeded" });
  });

  it("requires explicit completion and outputs", () => {
    const completion = {
      mode: "explicit" as const,
      requiredOutputs: [{ path: "report.md", mutation: "atomic_replace" as const }],
    };
    expect(
      reduceTerminalOutcome({
        completion,
        exitCode: 0,
        completionDeclarations: 1,
        completionStatus: "succeeded",
        requiredOutputs: [false],
      }).category,
    ).toBe("required_output_missing");
    expect(
      reduceTerminalOutcome({
        completion,
        exitCode: 0,
        completionDeclarations: 1,
        completionStatus: "succeeded",
        requiredOutputs: [true],
      }).status,
    ).toBe("succeeded");
  });

  it("lets recovered tool errors succeed after valid evidence", () => {
    expect(
      reduceTerminalOutcome({
        completion: { mode: "explicit", requiredOutputs: [] },
        exitCode: 0,
        completionDeclarations: 1,
        completionStatus: "succeeded",
      }),
    ).toEqual({ status: "succeeded" });
  });
});

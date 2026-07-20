import type { CompletionPolicy } from "../domain/permission.js";
import type { TerminalRunStatus } from "../domain/run.js";

export type OutcomeCategory =
  | "completion_failed"
  | "completion_missing"
  | "protocol_failure"
  | "command_failure"
  | "required_output_missing"
  | "sandbox_failure"
  | "manifest_failure"
  | "provider_failure"
  | "timeout"
  | "cancelled";

export interface OutcomeInput {
  completion: CompletionPolicy;
  exitCode: number | null;
  timedOut?: boolean;
  cancelled?: boolean;
  protocolFailure?: boolean;
  completionDeclarations?: number;
  completionStatus?: "succeeded" | "failed";
  requiredOutputs?: boolean[];
  sandboxFailure?: boolean;
  manifestFailure?: boolean;
}

export interface TerminalOutcome {
  status: TerminalRunStatus;
  category?: OutcomeCategory;
  message?: string;
}

/** Evidence-based terminal reducer. Timeout/cancellation always win races. */
export function reduceTerminalOutcome(input: OutcomeInput): TerminalOutcome {
  if (input.timedOut)
    return { status: "timed_out", category: "timeout", message: "Execution timed out" };
  if (input.cancelled)
    return { status: "cancelled", category: "cancelled", message: "Execution cancelled" };
  if (input.sandboxFailure)
    return { status: "failed", category: "sandbox_failure", message: "Sandbox enforcement failed" };
  if (input.manifestFailure)
    return { status: "failed", category: "manifest_failure", message: "Policy manifest failed" };
  if (input.exitCode !== 0) {
    return {
      status: "failed",
      category: "command_failure",
      message: "Child exited unsuccessfully",
    };
  }
  if (input.completion.mode === "process_exit") return { status: "succeeded" };
  if (input.protocolFailure || (input.completionDeclarations ?? 0) !== 1)
    return {
      status: "failed",
      category: input.protocolFailure ? "protocol_failure" : "completion_missing",
      message: input.protocolFailure
        ? "Completion protocol was invalid"
        : "Completion declaration is missing",
    };
  if (input.completionStatus !== "succeeded")
    return { status: "failed", category: "completion_failed", message: "Child declared failure" };
  if (input.requiredOutputs?.some((present) => !present))
    return {
      status: "failed",
      category: "required_output_missing",
      message: "Required output is missing",
    };
  return { status: "succeeded" };
}

import type { Run } from "../../src/domain/run.js";
import type { PumpExecutionResult } from "../../src/scheduler/execution-pump.js";
export function createFakeExecutor(result: PumpExecutionResult = { status: "succeeded" }) {
  const runs: Run[] = [];
  return {
    runs,
    execute: async (run: Run, _signal: AbortSignal) => {
      runs.push(run);
      return result;
    },
  };
}

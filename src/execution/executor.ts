import type { Job } from "../domain/job.js";
import type { Run } from "../domain/run.js";
import type { RunExecutor } from "../scheduler/execution-pump.js";
import { executeSubagent, type SubagentOptions } from "./subagent-adapter.js";

export interface ExecutorOptions extends SubagentOptions {
  getJob: (jobId: string) => Job | undefined;
}

export function createExecutor(options: ExecutorOptions): RunExecutor {
  return async (run: Run, signal: AbortSignal) => {
    const job = options.getJob(run.jobId);
    if (!job)
      return {
        status: "failed",
        message: "Job was deleted before execution",
      };
    const result = await executeSubagent(job, run, signal, options);
    if (!result.ok)
      return {
        status: "failed",
        message: result.error.message,
        errorCode: result.error.code,
      };
    return {
      status: result.value.status,
      message: result.value.error,
      errorCode: result.value.errorCode,
      output: result.value.output,
    };
  };
}

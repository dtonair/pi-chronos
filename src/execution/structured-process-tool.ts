import { accessSync, constants } from "node:fs";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { AuthorizedProcess } from "../security/process-policy.js";
import { resolveExecutable } from "../security/process-policy.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { spawnChild } from "./process-control.js";

export interface StructuredProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export async function executeStructuredProcess(
  processCall: AuthorizedProcess,
  options: {
    cwd: string;
    env?: Record<string, string>;
    maxOutputBytes: number;
    timeoutMs: number;
    signal?: AbortSignal;
    sandboxRequired?: boolean;
    sandboxProfilePath?: string;
    sandboxExecutable?: string;
  },
): Promise<Result<StructuredProcessResult>> {
  const rechecked = resolveExecutable(
    processCall.rule.executable,
    options.env?.PATH ?? process.env.PATH ?? "",
  );
  if (!rechecked.ok || rechecked.value !== processCall.executable) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: "Executable identity changed before launch",
      }),
    );
  }
  let executable = processCall.executable;
  let args = processCall.args;
  if (options.sandboxRequired) {
    const sandboxExecutable = options.sandboxExecutable ?? "/usr/bin/sandbox-exec";
    if (
      !options.sandboxProfilePath ||
      !canExecute(sandboxExecutable) ||
      !canRead(options.sandboxProfilePath)
    ) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.SANDBOX_UNAVAILABLE,
          message: "Sandbox profile is unavailable",
        }),
      );
    }
    executable = sandboxExecutable;
    args = ["-f", options.sandboxProfilePath, processCall.executable, ...processCall.args];
  }
  let child: ReturnType<typeof spawnChild>;
  try {
    child = spawnChild(executable, args, { cwd: options.cwd, env: options.env ?? {}, stdin: "" });
  } catch (cause) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.EXECUTOR_ERROR,
        message: "Failed to launch process",
        cause,
      }),
    );
  }
  let cancelled = false;
  let timedOut = false;
  const terminate = () => child.terminate();
  const onAbort = () => {
    cancelled = true;
    terminate();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
    setTimeout(() => child.kill(), 5_000);
  }, options.timeoutMs);
  const stdout: string[] = [];
  const stderr: string[] = [];
  let bytes = 0;
  const collect = async (stream: AsyncIterable<string>, target: string[]) => {
    for await (const chunk of stream) {
      const remaining = options.maxOutputBytes - bytes;
      if (remaining > 0) {
        const text = Buffer.from(chunk).subarray(0, remaining).toString("utf8");
        target.push(text);
        bytes += Buffer.byteLength(text);
      }
    }
  };
  await Promise.all([collect(child.stdout, stdout), collect(child.stderr, stderr)]);
  const completed = await child.completed;
  clearTimeout(timer);
  options.signal?.removeEventListener("abort", onAbort);
  if (timedOut || cancelled) child.kill();
  return ok({
    exitCode: completed.exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    truncated: bytes >= options.maxOutputBytes,
  });
}

function canRead(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

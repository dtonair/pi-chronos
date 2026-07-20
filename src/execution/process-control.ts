import { type ChildProcess, spawn } from "node:child_process";
import type { ProcessResult } from "../shared/ports.js";

export interface ChildProcessHandle {
  readonly pid: number;
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly completed: Promise<ProcessResult>;
  terminate(): void;
  kill(): void;
}

export function spawnChild(
  executable: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; stdin: string },
): ChildProcessHandle {
  const child = spawn(executable, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: process.platform !== "win32",
  });
  child.stdin?.end(options.stdin);
  const stdout = chunks(child.stdout);
  const stderr = chunks(child.stderr);
  const completed = completion(child);
  return {
    pid: child.pid ?? -1,
    stdout,
    stderr,
    completed,
    terminate: () => signalTree(child, "SIGTERM"),
    kill: () => {
      signalTree(child, "SIGKILL");
      // A descendant can retain inherited stdio after the direct child dies.
      // Closing our pipe ends guarantees completion does not wait forever for
      // a leaked descendant stream.
      child.stdout?.destroy();
      child.stderr?.destroy();
    },
  };
}

async function* chunks(stream: NodeJS.ReadableStream | null): AsyncIterable<string> {
  if (!stream) return;
  for await (const chunk of stream)
    yield Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
}

function completion(child: ChildProcess): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stderr = "";
    const maxStderrBytes = 64 * 1024;
    child.stderr?.on("data", (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      if (Buffer.byteLength(stderr) < maxStderrBytes) {
        const remaining = maxStderrBytes - Buffer.byteLength(stderr);
        stderr += Buffer.from(text).subarray(0, remaining).toString("utf8");
      }
    });
    child.on("close", (exitCode, signal) =>
      resolve({ stdout: "", stderr, exitCode, signal, timedOut: false, truncated: false }),
    );
    child.on("error", (error) =>
      resolve({
        stdout: "",
        stderr: `${stderr}${error.message}`,
        exitCode: null,
        signal: null,
        timedOut: false,
        truncated: false,
      }),
    );
  });
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already exited */
    }
  }
}

import { spawn } from "node:child_process";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

/** Bash backend used by the child guard; the command string was authorized first. */
export function createSandboxedBashOperations(
  profilePath: string | undefined | (() => string | undefined),
  timeoutLimit: number | undefined | (() => number | undefined) = undefined,
  sandboxExecutable = "/usr/bin/sandbox-exec",
): BashOperations {
  return {
    exec(command, cwd, options) {
      const activeProfile = typeof profilePath === "function" ? profilePath() : profilePath;
      const executable = activeProfile ? sandboxExecutable : "/bin/bash";
      const args = activeProfile
        ? ["-f", activeProfile, "/bin/bash", "-c", command]
        : ["-c", command];
      return new Promise((resolve) => {
        const child = spawn(executable, args, {
          cwd,
          env: options.env,
          shell: false,
          detached: process.platform !== "win32",
        });
        const forward = (chunk: Buffer) => options.onData(chunk);
        child.stdout?.on("data", forward);
        child.stderr?.on("data", forward);
        let finished = false;
        const finish = (exitCode: number | null) => {
          if (finished) return;
          finished = true;
          resolve({ exitCode });
        };
        child.on("close", (exitCode) => finish(exitCode));
        child.on("error", () => finish(null));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const configuredTimeout =
          typeof timeoutLimit === "function" ? timeoutLimit() : timeoutLimit;
        const timeout =
          options.timeout === undefined
            ? configuredTimeout
            : configuredTimeout === undefined
              ? options.timeout
              : Math.min(options.timeout, configuredTimeout);
        if (timeout !== undefined) {
          timer = setTimeout(() => {
            signalTree(child, "SIGTERM");
            setTimeout(() => signalTree(child, "SIGKILL"), 5_000);
          }, timeout);
        }
        const abort = () => signalTree(child, "SIGTERM");
        options.signal?.addEventListener("abort", abort, { once: true });
        child.once("close", () => {
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
        });
      });
    },
  };
}

function signalTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already exited.
    }
  }
}

import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export interface SandboxHandle {
  wrapExecutable(
    executable: string,
    args: readonly string[],
  ): { executable: string; args: readonly string[] };
  close(): Promise<void>;
}

export interface SandboxAdapter {
  readonly supported: boolean;
  initialize(options: {
    workingDirectory: string;
    readOnly: boolean;
    readPaths?: readonly string[];
    writePaths?: readonly string[];
    networkAllowed?: boolean;
  }): Promise<Result<SandboxHandle>>;
}

function unavailable(message = "OS sandbox is unavailable"): Result<SandboxHandle> {
  return err(
    new ChronosError({
      code: ChronosErrorCode.SANDBOX_UNAVAILABLE,
      message,
    }),
  );
}

/** Default adapter is explicit: tool policy is not misreported as OS isolation. */
export const unavailableSandbox: SandboxAdapter = {
  supported: false,
  async initialize(): Promise<Result<SandboxHandle>> {
    return unavailable();
  },
};

export const disabledSandbox: SandboxAdapter = {
  supported: false,
  async initialize(): Promise<Result<SandboxHandle>> {
    return ok({
      wrapExecutable: (executable, args) => ({ executable, args }),
      close: async () => undefined,
    });
  },
};

function quoteSbplPath(path: string): string {
  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Use Apple's built-in sandbox-exec when present. Linux/Windows deliberately
 * remain unavailable unless a separately reviewed adapter is supplied.
 * The adapter never invokes a shell; sandbox-exec receives argv directly.
 */
export function createPlatformSandboxAdapter(
  platform: NodeJS.Platform = process.platform,
  executablePath = "/usr/bin/sandbox-exec",
  probe = true,
): SandboxAdapter {
  const supported =
    platform === "darwin" &&
    canExecute(executablePath) &&
    (!probe || canApplySandbox(executablePath));
  return {
    supported,
    async initialize(options): Promise<Result<SandboxHandle>> {
      if (!supported) return unavailable();
      const readPaths = [options.workingDirectory, ...(options.readPaths ?? [])];
      const writePaths = options.readOnly
        ? []
        : [options.workingDirectory, ...(options.writePaths ?? [])];
      const profile = [
        "(version 1)",
        "(deny default)",
        "(allow process-fork)",
        "(allow process-exec)",
        "(allow signal (target self))",
        ...readPaths.map((path) => `(allow file-read* (subpath ${quoteSbplPath(path)}))`),
        ...writePaths.map((path) => `(allow file-write* (subpath ${quoteSbplPath(path)}))`),
        ...(options.networkAllowed === true ? ["(allow network*)"] : []),
      ].join(" ");
      return ok({
        wrapExecutable: (executable, args) => ({
          executable: executablePath,
          // The executable itself may live outside the job's declared data
          // roots; allow only that exact file, never its containing directory.
          args: [
            "-p",
            `${profile} (allow file-read* (literal ${quoteSbplPath(executable)}))`,
            "--",
            executable,
            ...args,
          ],
        }),
        close: async () => undefined,
      });
    },
  };
}

function canApplySandbox(path: string): boolean {
  try {
    const result = spawnSync(path, ["-p", "(version 1) (allow process*)", "--", "/usr/bin/true"], {
      stdio: "ignore",
      timeout: 1_000,
      shell: false,
    });
    return result.status === 0;
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

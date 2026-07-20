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

/** Shared profile published by pi-seatbelt-sandbox for other trusted extensions. */
export const PI_SEATBELT_PROFILE_ENV = "PI_SEATBELT_PROFILE";

/**
 * Use Apple's built-in sandbox-exec when present. Linux/Windows deliberately
 * remain unavailable unless a separately reviewed adapter is supplied.
 *
 * When pi-seatbelt-sandbox publishes its active profile, reuse that profile
 * unchanged. This keeps one user-controlled OS boundary: Chronos cannot widen
 * it and does not impose a second network/filesystem policy. Chronos' separate
 * approval-bound tool and canonical-path guard remains active inside the child.
 * The adapter never invokes a shell; sandbox-exec receives argv directly.
 */
export function createPlatformSandboxAdapter(
  platform: NodeJS.Platform = process.platform,
  executablePath = "/usr/bin/sandbox-exec",
  probe = true,
  getSharedProfile: () => string | undefined = () => process.env[PI_SEATBELT_PROFILE_ENV],
): SandboxAdapter {
  const locallySupported =
    platform === "darwin" &&
    canExecute(executablePath) &&
    (!probe || canApplySandbox(executablePath));
  const sharedProfile = (): string | undefined => {
    if (platform !== "darwin" || !canExecute(executablePath)) return undefined;
    const path = getSharedProfile();
    return path !== undefined && path.length > 0 && canRead(path) ? path : undefined;
  };
  return {
    get supported() {
      return sharedProfile() !== undefined || locallySupported;
    },
    async initialize(options): Promise<Result<SandboxHandle>> {
      const profilePath = sharedProfile();
      if (profilePath !== undefined) {
        return ok({
          wrapExecutable: (executable, args) => ({
            executable: executablePath,
            args: ["-f", profilePath, "--", executable, ...args],
          }),
          close: async () => undefined,
        });
      }
      if (!locallySupported) return unavailable();
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

function canRead(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

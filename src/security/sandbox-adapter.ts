import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { createSeatbeltProfile, type SeatbeltProfileHandle } from "./seatbelt-profile.js";

/** Reserved parent-to-child handoff; the guard removes it during startup. */
export const CHRONOS_SEATBELT_PROFILE_ENV = "CHRONOS_SEATBELT_PROFILE";
export const CHRONOS_SANDBOX_REQUIRED_ENV = "CHRONOS_SANDBOX_REQUIRED";
/** pi-seatbelt-sandbox's interactive export is deliberately not consumed. */
export const PI_SEATBELT_PROFILE_ENV = "PI_SEATBELT_PROFILE";

export interface SandboxHandle {
  readonly scope: "tool-subprocess-v1";
  readonly profilePath?: string;
  wrapExecutable(
    executable: string,
    args: readonly string[],
  ): { executable: string; args: readonly string[] };
  wrapCommand(
    executable: string,
    args: readonly string[],
  ): { executable: string; args: readonly string[] };
  close(): Promise<void>;
}

export interface SandboxAdapter {
  readonly supported: boolean;
  readonly status?: "active-tool-subprocess" | "disabled" | "unavailable";
  initialize(options: {
    workingDirectory: string;
    readOnly: boolean;
    readPaths?: readonly string[];
    writePaths?: readonly string[];
    networkAllowed?: boolean;
    executablePaths?: readonly string[];
  }): Promise<Result<SandboxHandle>>;
}

function unavailable(message = "OS sandbox is unavailable"): Result<SandboxHandle> {
  return err(new ChronosError({ code: ChronosErrorCode.SANDBOX_UNAVAILABLE, message }));
}

export const unavailableSandbox: SandboxAdapter = {
  supported: false,
  status: "unavailable",
  async initialize(): Promise<Result<SandboxHandle>> {
    return unavailable();
  },
};

export const disabledSandbox: SandboxAdapter = {
  supported: false,
  status: "disabled",
  async initialize(): Promise<Result<SandboxHandle>> {
    return ok({
      scope: "tool-subprocess-v1",
      wrapExecutable: (executable, args) => ({ executable, args }),
      wrapCommand: (executable, args) => ({ executable, args }),
      close: async () => undefined,
    });
  },
};

/**
 * macOS Seatbelt adapter. The child Pi is never wrapped: only commands
 * launched by the trusted child guard use the private run profile.
 *
 * `getSharedProfile` is retained solely as an explicit test adapter hook for
 * compatibility with older callers. The production default never reads
 * PI_SEATBELT_PROFILE, whose session/workspace scope is not portable.
 */
export function createPlatformSandboxAdapter(
  platform: NodeJS.Platform = process.platform,
  executablePath = "/usr/bin/sandbox-exec",
  probe = true,
  getSharedProfile: () => string | undefined = () => undefined,
): SandboxAdapter {
  const locallySupported =
    platform === "darwin" &&
    canExecute(executablePath) &&
    (!probe || canApplySandbox(executablePath));
  const injectedProfile = (): string | undefined => {
    if (platform !== "darwin" || !canExecute(executablePath)) return undefined;
    const path = getSharedProfile();
    return path !== undefined && path.length > 0 && canRead(path) ? path : undefined;
  };
  return {
    status:
      platform === "darwin"
        ? locallySupported
          ? "active-tool-subprocess"
          : "unavailable"
        : "disabled",
    // A real adapter's capability is local; the injected profile hook exists
    // only for deterministic unit tests and is not an environment contract.
    get supported() {
      return locallySupported || injectedProfile() !== undefined;
    },
    async initialize(options): Promise<Result<SandboxHandle>> {
      const testProfile = injectedProfile();
      if (testProfile !== undefined) {
        return ok(makeHandle(executablePath, testProfile, async () => undefined));
      }
      if (!locallySupported) return unavailable();
      let profile: SeatbeltProfileHandle;
      try {
        profile = await createSeatbeltProfile(options);
      } catch (cause) {
        return unavailable(`Failed to create Seatbelt profile: ${String(cause)}`);
      }
      if (probe && !canApplyProfile(executablePath, profile.path)) {
        await profile.close();
        return unavailable("sandbox-exec rejected the generated profile");
      }
      return ok(makeHandle(executablePath, profile.path, profile.close));
    },
  };
}

function makeHandle(
  sandboxExecutable: string,
  profilePath: string,
  close: () => Promise<void>,
): SandboxHandle {
  const wrap = (executable: string, args: readonly string[]) => ({
    executable: sandboxExecutable,
    args: ["-f", profilePath, executable, ...args],
  });
  return {
    scope: "tool-subprocess-v1",
    profilePath,
    wrapExecutable: wrap,
    wrapCommand: wrap,
    close,
  };
}

function canApplyProfile(executable: string, profile: string): boolean {
  try {
    const result = spawnSync(executable, ["-f", profile, "/usr/bin/true"], {
      stdio: "ignore",
      timeout: 1_000,
      shell: false,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function canApplySandbox(path: string): boolean {
  try {
    // Probe sandbox application, not policy completeness. A process-only
    // profile rejects dyld/runtime file reads on macOS and falsely reports a
    // working sandbox-exec as unavailable.
    const result = spawnSync(path, ["-p", "(version 1) (allow default)", "/usr/bin/true"], {
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

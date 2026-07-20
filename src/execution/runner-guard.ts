import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { PolicyManifest } from "../domain/permission.js";
import { authorizeToolCall, type ToolCall } from "../security/policy-engine.js";
import type { EventSink, PathCanonicalizer } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { removeSchedulerTool } from "./guard-tools.js";

/** Host-neutral trusted child guard; a Pi adapter can bind these methods to lifecycle hooks. */
export interface RunnerGuardOptions {
  profilePath?: string;
  sandboxRequired?: boolean;
  maxOutputBytes?: number;
  timeoutMs?: number;
  delegateToPiSeatbelt?: boolean;
}

export function createRunnerGuard(
  manifest: PolicyManifest,
  cwd: string,
  canonicalizer?: PathCanonicalizer,
  events?: EventSink,
  options: RunnerGuardOptions = {},
) {
  let active = false;
  function sessionStart(now: number): Result<void> {
    if (manifest.expiresAt <= now)
      return err(
        new ChronosError({
          code: ChronosErrorCode.MANIFEST_EXPIRED,
          message: "Policy manifest has expired",
        }),
      );
    active = true;
    return ok(undefined);
  }
  async function authorize(call: ToolCall): Promise<Awaited<ReturnType<typeof authorizeToolCall>>> {
    if (!active || call.tool === "scheduler") {
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: "Tool is unavailable in the runner guard",
        }),
      );
    }
    if (options.delegateToPiSeatbelt && call.tool !== "chronos_complete") {
      return ok(undefined);
    }
    return authorizeToolCall(call, {
      cwd,
      permissions: manifest.permissions,
      canonicalizer,
      events,
      sandboxProfilePath: options.profilePath,
      sandboxRequired: options.sandboxRequired,
    });
  }
  function tools<T extends { name: string }>(available: readonly T[]): T[] {
    return removeSchedulerTool(available);
  }
  function sessionShutdown(): void {
    active = false;
  }
  return {
    sessionStart,
    sandboxProfilePath: options.profilePath,
    permissions: manifest.permissions,
    cwd,
    sandboxRequired: options.sandboxRequired,
    maxOutputBytes: options.maxOutputBytes,
    timeoutMs: options.timeoutMs,
    delegateToPiSeatbelt: options.delegateToPiSeatbelt,
    authorize,
    tools,
    sessionShutdown,
    get active(): boolean {
      return active;
    },
  };
}

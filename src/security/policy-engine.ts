import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobPermissions } from "../domain/permission.js";
import type { EventSink, PathCanonicalizer } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { checkPathAllowed } from "./path-policy.js";
import { authorizeStructuredProcess } from "./process-policy.js";
import { checkShellCommand } from "./shell-policy.js";

export const SUPPORTED_GUARD_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "edit",
  "write",
  "bash",
  "chronos_exec",
  "chronos_atomic_write",
  "chronos_complete",
] as const;
export type GuardTool = (typeof SUPPORTED_GUARD_TOOLS)[number];

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface PolicyEngineOptions {
  cwd: string;
  permissions: JobPermissions;
  canonicalizer?: PathCanonicalizer;
  events?: EventSink;
  /** Captured run-specific profile, never read from PI_SEATBELT_PROFILE. */
  sandboxProfilePath?: string;
  sandboxRequired?: boolean;
}

/** Enforce the persisted policy at each child tool call. */
export async function authorizeToolCall(
  call: ToolCall,
  options: PolicyEngineOptions,
): Promise<Result<void>> {
  const result = await authorizeToolCallInternal(call, options);
  if (!result.ok) {
    options.events?.emit({
      type: "policy.denied",
      timestamp: Date.now() as import("../domain/job.js").UTCTimestamp,
      entityId: call.tool,
      error: result.error.message,
      payload: { code: result.error.code },
    });
  }
  return result;
}

async function authorizeToolCallInternal(
  call: ToolCall,
  options: PolicyEngineOptions,
): Promise<Result<void>> {
  if (!(SUPPORTED_GUARD_TOOLS as readonly string[]).includes(call.tool)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.UNSUPPORTED_TOOL,
        message: `Unsupported tool: ${call.tool}`,
        entity: call.tool,
      }),
    );
  }
  if (call.tool !== "chronos_complete" && !options.permissions.tools.includes(call.tool)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: `Tool is not allowlisted: ${call.tool}`,
        entity: call.tool,
      }),
    );
  }
  if (call.tool === "chronos_complete") {
    if (
      (call.input.status !== "succeeded" && call.input.status !== "failed") ||
      typeof call.input.summary !== "string" ||
      call.input.summary.length === 0 ||
      Buffer.byteLength(call.input.summary) > 4_096
    ) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: "Invalid completion declaration",
        }),
      );
    }
    return ok(undefined);
  }
  if (call.tool === "chronos_exec") {
    if (options.sandboxRequired && options.sandboxProfilePath === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.SANDBOX_UNAVAILABLE,
          message: "Sandbox profile is unavailable",
        }),
      );
    }
    const authorizedProcess = authorizeStructuredProcess(
      { executable: call.input.executable, args: call.input.args },
      options.permissions.process,
      globalThis.process.env.PATH ?? "",
    );
    return authorizedProcess.ok ? ok(undefined) : authorizedProcess;
  }
  if (call.tool === "bash") {
    if (options.sandboxRequired && options.sandboxProfilePath === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.SANDBOX_UNAVAILABLE,
          message: "Sandbox profile is unavailable",
        }),
      );
    }
    const command = call.input.command;
    if (typeof command !== "string")
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: "bash command is required",
        }),
      );
    return checkShellCommand(command, options.permissions);
  }

  const paths = extractPaths(call.input);
  const operation =
    call.tool === "read" || call.tool === "grep" || call.tool === "find" || call.tool === "ls"
      ? "read"
      : "write";
  if (paths.length === 0)
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: `${call.tool} path is required`,
      }),
    );
  for (const path of paths) {
    const result = await checkPathAllowed(
      path,
      options.cwd,
      operation,
      options.permissions,
      options.canonicalizer,
    );
    if (!result.ok) return result;
  }
  return ok(undefined);
}

function extractPaths(input: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const key of ["path", "filePath", "target", "directory"]) {
    if (typeof input[key] === "string") result.push(input[key] as string);
  }
  for (const key of ["paths", "files"]) {
    if (Array.isArray(input[key]))
      result.push(...input[key].filter((item): item is string => typeof item === "string"));
  }
  return result;
}

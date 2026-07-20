import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobPermissions } from "../domain/permission.js";
import type { EventSink, PathCanonicalizer } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { checkPathAllowed } from "./path-policy.js";
import { checkShellCommand } from "./shell-policy.js";

export const SUPPORTED_GUARD_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "edit",
  "write",
  "bash",
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
  if (!options.permissions.tools.includes(call.tool)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: `Tool is not allowlisted: ${call.tool}`,
        entity: call.tool,
      }),
    );
  }
  if (call.tool === "bash") {
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

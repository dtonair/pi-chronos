import { Type } from "typebox";
import type { ToolCall } from "../security/policy-engine.js";
import { authorizeStructuredProcess } from "../security/process-policy.js";
import { atomicWrite } from "./atomic-write.js";
import { executeStructuredProcess } from "./structured-process-tool.js";

/** The child guard never exposes the scheduler control tool to the child. */
export function removeSchedulerTool<T extends { name: string }>(tools: readonly T[]): T[] {
  return tools.filter((tool) => tool.name !== "scheduler");
}

export function isSchedulerToolCall(call: ToolCall): boolean {
  return call.tool === "scheduler";
}

export const ChronosExecParameters = Type.Object(
  {
    executable: Type.String({ minLength: 1, maxLength: 4_096 }),
    args: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 32 }),
  },
  { additionalProperties: false },
);
export const ChronosAtomicWriteParameters = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    content: Type.String({ maxLength: 1_048_576 }),
  },
  { additionalProperties: false },
);
export const ChronosCompleteParameters = Type.Object(
  {
    status: Type.Union([Type.Literal("succeeded"), Type.Literal("failed")]),
    summary: Type.String({ minLength: 1, maxLength: 4_096 }),
  },
  { additionalProperties: false },
);

export function createChronosToolDefinitions(
  getGuard: () =>
    | {
        authorize(call: ToolCall): Promise<import("../shared/result.js").Result<void>>;
        permissions: import("../domain/permission.js").JobPermissions;
        cwd: string;
        sandboxProfilePath?: string;
        maxOutputBytes?: number;
        timeoutMs?: number;
      }
    | undefined,
) {
  const textResult = (text: string) => ({
    content: [{ type: "text" as const, text }],
    details: null,
  });
  return [
    {
      name: "chronos_exec",
      label: "Chronos exec",
      description: "Run one approved executable with an exact structured argv policy.",
      promptSnippet: "Run an approval-bound executable without a shell",
      parameters: ChronosExecParameters,
      async execute(
        _id: string,
        params: { executable: string; args: string[] },
        signal?: AbortSignal,
      ) {
        const guard = getGuard();
        if (!guard) return textResult("Chronos policy manifest unavailable");
        const authorized = authorizeStructuredProcess(
          params,
          guard.permissions.process,
          process.env.PATH ?? "",
        );
        if (!authorized.ok) return textResult(authorized.error.message);
        const result = await executeStructuredProcess(authorized.value, {
          cwd: guard.cwd,
          env: Object.fromEntries(
            Object.entries(process.env).filter(([name]) => !name.startsWith("CHRONOS_")),
          ) as Record<string, string>,
          maxOutputBytes: guard.maxOutputBytes ?? 262_144,
          timeoutMs: guard.timeoutMs ?? 600_000,
          signal,
          sandboxRequired: guard.sandboxProfilePath !== undefined,
          sandboxProfilePath: guard.sandboxProfilePath,
        });
        if (!result.ok) return textResult(result.error.message);
        return textResult(`${result.value.stdout}${result.value.stderr}`.slice(0, 262_144));
      },
    },
    {
      name: "chronos_atomic_write",
      label: "Chronos atomic write",
      description: "Replace one approved report path atomically.",
      promptSnippet: "Atomically replace an approved output file",
      parameters: ChronosAtomicWriteParameters,
      async execute(_id: string, params: { path: string; content: string }, signal?: AbortSignal) {
        const guard = getGuard();
        if (!guard) return textResult("Chronos policy manifest unavailable");
        const result = await atomicWrite(params.path, params.content, {
          cwd: guard.cwd,
          permissions: guard.permissions,
          signal,
        });
        return result.ok
          ? textResult(JSON.stringify(result.value))
          : textResult(result.error.message);
      },
    },
    {
      name: "chronos_complete",
      label: "Chronos complete",
      description: "Declare the bounded terminal outcome of this scheduled run.",
      promptSnippet: "Declare scheduled run completion",
      parameters: ChronosCompleteParameters,
      async execute(_id: string, params: { status: "succeeded" | "failed"; summary: string }) {
        // The parent parser treats this as protocol evidence. It has no
        // permission-granting or external side effects.
        return textResult(JSON.stringify({ status: params.status, summary: params.summary }));
      },
    },
  ];
}

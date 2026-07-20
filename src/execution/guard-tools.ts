import type { ToolCall } from "../security/policy-engine.js";

/** The child guard never exposes the scheduler control tool to the child. */
export function removeSchedulerTool<T extends { name: string }>(tools: readonly T[]): T[] {
  return tools.filter((tool) => tool.name !== "scheduler");
}

export function isSchedulerToolCall(call: ToolCall): boolean {
  return call.tool === "scheduler";
}

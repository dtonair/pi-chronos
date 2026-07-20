import { describe, expect, it } from "vitest";
import type { createActionRouter } from "../../../src/api/action-router.js";
import { createSchedulerTool } from "../../../src/api/scheduler-tool.js";

describe("scheduler tool adapter", () => {
  it("forwards structured calls to the action router", async () => {
    const calls: unknown[] = [];
    const router = {
      route: async (value: unknown, actor: string, mode: string) => {
        calls.push([value, actor, mode]);
        return { ok: true, data: { accepted: true } } as const;
      },
    } as unknown as ReturnType<typeof createActionRouter>;
    const tool = createSchedulerTool(router);
    expect(tool.name).toBe("scheduler");
    const result = await tool.execute({ action: "health" }, "alice", "json");
    expect(result).toEqual({ ok: true, data: { accepted: true } });
    expect(calls).toEqual([[{ action: "health" }, "alice", "json"]]);
  });
});

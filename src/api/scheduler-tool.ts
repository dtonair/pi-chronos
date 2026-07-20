import type { createActionRouter } from "./action-router.js";
import { SchedulerToolInputSchema } from "./schemas.js";

export function createSchedulerTool(router: ReturnType<typeof createActionRouter>) {
  return {
    name: "scheduler",
    label: "Scheduler",
    description: "Manage durable Chronos scheduled agent jobs.",
    parameters: SchedulerToolInputSchema,
    async execute(params: unknown, actor: string, mode: "tui" | "rpc" | "json" | "print") {
      return router.route(params, actor, mode);
    },
  };
}

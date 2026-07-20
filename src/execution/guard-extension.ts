import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UTCTimestamp } from "../domain/job.js";
import { PolicyManifestStore } from "../security/policy-manifest.js";
import { createRunnerGuard } from "./runner-guard.js";

/** Trusted child Pi extension. It consumes one manifest before allowing tools. */
export default function runnerGuardExtension(pi: ExtensionAPI): void {
  let guard: ReturnType<typeof createRunnerGuard> | undefined;
  const path = process.env.CHRONOS_POLICY_MANIFEST;
  pi.on("session_start", async (_event, _ctx) => {
    // The child must never receive the parent scheduler control tool, even if
    // manifest validation later fails and the guard blocks all execution.
    pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "scheduler"));
    if (!path) return;
    try {
      const store = new PolicyManifestStore(dirname(path));
      const result = await store.readAndConsume(
        path,
        {
          runId: process.env.CHRONOS_RUN_ID ?? "",
          jobId: process.env.CHRONOS_JOB_ID ?? "",
          ownerId: process.env.CHRONOS_OWNER_ID ?? "",
          fingerprint: process.env.CHRONOS_FINGERPRINT ?? "",
        },
        Date.now() as UTCTimestamp,
      );
      if (!result.ok) {
        guard = undefined;
        return;
      }
      guard = createRunnerGuard(result.value, process.cwd());
      guard.sessionStart(Date.now());
    } catch {
      guard = undefined;
    }
  });
  pi.on("tool_call", async (event) => {
    if (!guard) return { block: true, reason: "Chronos policy manifest unavailable" };
    const result = await guard.authorize({
      tool: event.toolName,
      input: event.input as Record<string, unknown>,
    });
    return result.ok ? undefined : { block: true, reason: result.error.message };
  });
  pi.on("session_shutdown", async () => {
    guard?.sessionShutdown();
    guard = undefined;
    if (path) await new PolicyManifestStore(dirname(path)).remove(path);
  });
}

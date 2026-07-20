import { accessSync, constants, statSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { UTCTimestamp } from "../domain/job.js";
import { PolicyManifestStore } from "../security/policy-manifest.js";
import {
  CHRONOS_SANDBOX_REQUIRED_ENV,
  CHRONOS_SEATBELT_PROFILE_ENV,
} from "../security/sandbox-adapter.js";
import { createChronosToolDefinitions } from "./guard-tools.js";
import {
  CHRONOS_PERMISSION_MODE_ENV,
  delegatesToPiSeatbelt,
  PI_SEATBELT_PROFILE_ENV,
  PI_SEATBELT_PROFILE_SCOPE,
  PI_SEATBELT_PROFILE_SCOPE_ENV,
} from "./permission-mode.js";
import { createRunnerGuard } from "./runner-guard.js";
import { createSandboxedBashOperations } from "./sandboxed-bash.js";

/** Trusted child Pi extension. It consumes one manifest before allowing tools. */
export default function runnerGuardExtension(pi: ExtensionAPI): void {
  let guard: ReturnType<typeof createRunnerGuard> | undefined;
  const path = process.env.CHRONOS_POLICY_MANIFEST;
  const permissionMode = process.env[CHRONOS_PERMISSION_MODE_ENV] as
    | "job"
    | "pi-seatbelt-sandbox"
    | undefined;
  const delegateToPiSeatbelt = delegatesToPiSeatbelt(permissionMode);
  if (typeof pi.registerTool === "function") {
    for (const tool of createChronosToolDefinitions(() => guard)) {
      pi.registerTool(tool as Parameters<typeof pi.registerTool>[0]);
    }
  }
  let sandboxProfilePath: string | undefined;
  let sandboxRequired = false;
  let maxOutputBytes = 262_144;
  let timeoutMs = 600_000;
  if (typeof pi.registerTool === "function" && !delegateToPiSeatbelt) {
    pi.registerTool(
      createBashToolDefinition(process.cwd(), {
        operations: createSandboxedBashOperations(
          () => sandboxProfilePath,
          () => timeoutMs,
        ),
      }),
    );
  }
  pi.on("session_start", async (_event, _ctx) => {
    // Capture policy-control metadata once, then ensure model tools and any
    // descendants cannot discover or replace the parent-controlled profile.
    const chronosProfile = process.env[CHRONOS_SEATBELT_PROFILE_ENV];
    const delegatedProfile = process.env[PI_SEATBELT_PROFILE_ENV];
    const delegatedProfileReady =
      delegateToPiSeatbelt &&
      process.env[PI_SEATBELT_PROFILE_SCOPE_ENV] === PI_SEATBELT_PROFILE_SCOPE &&
      delegatedProfile !== undefined &&
      canRead(delegatedProfile);
    sandboxProfilePath = delegateToPiSeatbelt ? delegatedProfile : chronosProfile;
    sandboxRequired = delegateToPiSeatbelt || process.env[CHRONOS_SANDBOX_REQUIRED_ENV] === "1";
    maxOutputBytes = boundedNumber(
      process.env.CHRONOS_MAX_OUTPUT_BYTES,
      1_024,
      10_485_760,
      262_144,
    );
    timeoutMs = boundedNumber(process.env.CHRONOS_TIMEOUT_MS, 1_000, 86_400_000, 600_000);
    delete process.env[CHRONOS_SEATBELT_PROFILE_ENV];
    delete process.env[CHRONOS_SANDBOX_REQUIRED_ENV];
    delete process.env[CHRONOS_PERMISSION_MODE_ENV];
    delete process.env[PI_SEATBELT_PROFILE_ENV];
    delete process.env[PI_SEATBELT_PROFILE_SCOPE_ENV];
    delete process.env.CHRONOS_MAX_OUTPUT_BYTES;
    delete process.env.CHRONOS_TIMEOUT_MS;
    // The child must never receive the parent scheduler control tool, even if
    // manifest validation later fails and the guard blocks all execution.
    pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "scheduler"));
    if (!path || (delegateToPiSeatbelt && !delegatedProfileReady)) return;
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
      guard = createRunnerGuard(result.value, process.cwd(), undefined, undefined, {
        profilePath: sandboxProfilePath,
        sandboxRequired,
        maxOutputBytes,
        timeoutMs,
        delegateToPiSeatbelt,
      });
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
    sandboxProfilePath = undefined;
    sandboxRequired = false;
    maxOutputBytes = 262_144;
    timeoutMs = 600_000;
    if (path) await new PolicyManifestStore(dirname(path)).remove(path);
  });
}

function canRead(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    const info = statSync(path);
    if (!info.isFile()) return false;
    if (process.platform !== "win32") {
      if (typeof process.getuid === "function" && info.uid !== process.getuid()) return false;
      if ((info.mode & 0o077) !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function boundedNumber(
  value: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

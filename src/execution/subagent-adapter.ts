import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Job, UTCTimestamp } from "../domain/job.js";
import type { Run, RunOutput } from "../domain/run.js";
import { validateEnvironment } from "../security/environment-policy.js";
import { checkPathAllowed } from "../security/path-policy.js";
import { PolicyManifestStore } from "../security/policy-manifest.js";
import { resolveExecutable } from "../security/process-policy.js";
import {
  CHRONOS_SANDBOX_REQUIRED_ENV,
  CHRONOS_SEATBELT_PROFILE_ENV,
  type SandboxAdapter,
  type SandboxHandle,
} from "../security/sandbox-adapter.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { ArtifactStore } from "./artifact-store.js";
import { buildChildContext } from "./context-builder.js";
import { JsonlParser } from "./jsonl-parser.js";
import { reduceTerminalOutcome } from "./outcome.js";
import { limitOutput } from "./output-limiter.js";
import { buildPiInvocation } from "./pi-invocation.js";
import { spawnChild } from "./process-control.js";
import { redactText } from "./redactor.js";

export interface SubagentOptions {
  guardExtension: string;
  secretResolver?: (name: string) => string | undefined;
  graceMs?: number;
  ownerId?: string;
  manifestDirectory?: string;
  artifactDirectory?: string;
  sandbox?: SandboxAdapter;
}

export interface SubagentResult {
  status: "succeeded" | "failed" | "timed_out" | "cancelled";
  output?: RunOutput;
  error?: string;
  errorCode?: string;
}

export async function executeSubagent(
  job: Job,
  run: Run,
  signal: AbortSignal,
  options: SubagentOptions,
): Promise<Result<SubagentResult>> {
  const environmentValidation = validateEnvironment(
    job.definition.execution.environment,
    job.definition.permissions,
  );
  if (!environmentValidation.ok) return environmentValidation;
  const invocation = buildPiInvocation({
    model: job.definition.model,
    tools: job.definition.permissions.tools,
    guardExtension: options.guardExtension,
  });
  // The child Pi stays on the host so it can resolve provider auth and its
  // normal agent settings. Only trusted command tools consume the run profile.
  const executable = invocation.executable;
  const args = invocation.args;
  let sandboxHandle: SandboxHandle | undefined;
  if (job.definition.execution.sandboxRequired) {
    if (options.sandbox === undefined) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.SANDBOX_UNAVAILABLE,
          message: "This job requires an OS sandbox, but no adapter is configured",
        }),
      );
    }
    const sandbox = await options.sandbox.initialize({
      workingDirectory: job.definition.execution.workingDirectory,
      readOnly: job.definition.permissions.filesystem.writePaths.length === 0,
      readPaths: job.definition.permissions.filesystem.readPaths,
      writePaths: job.definition.permissions.filesystem.writePaths,
      networkAllowed: job.definition.permissions.network.allowed,
      executablePaths: (job.definition.permissions.process?.commands ?? [])
        .map((command) => {
          const resolved = resolveExecutable(command.executable);
          return resolved.ok ? resolved.value : undefined;
        })
        .filter((path): path is string => path !== undefined),
    });
    if (!sandbox.ok) return sandbox;
    sandboxHandle = sandbox.value;
  }
  const manifestStore = options.manifestDirectory
    ? new PolicyManifestStore(options.manifestDirectory)
    : undefined;
  const manifest = manifestStore
    ? await manifestStore.create(
        {
          runId: run.id,
          jobId: job.id,
          ownerId: options.ownerId ?? "unknown",
          fingerprint: job.fingerprint,
          permissions: {
            ...job.definition.permissions,
            canonicalReadPaths: [],
            canonicalWritePaths: [],
          },
        },
        Date.now() as UTCTimestamp,
        job.definition.execution.timeoutMs,
      )
    : undefined;
  if (manifest && !manifest.ok) {
    await sandboxHandle?.close();
    return manifest;
  }
  const environment: Record<string, string> = {};
  for (const name of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "PI_CODING_AGENT_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ]) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  const secretValues: string[] = [];
  environment.CHRONOS_MAX_OUTPUT_BYTES = String(job.definition.execution.maxOutputBytes);
  environment.CHRONOS_TIMEOUT_MS = String(job.definition.execution.timeoutMs);
  if (manifest?.ok) {
    environment.CHRONOS_POLICY_MANIFEST = manifest.value.path;
    environment.CHRONOS_RUN_ID = run.id;
    environment.CHRONOS_JOB_ID = job.id;
    environment.CHRONOS_OWNER_ID = options.ownerId ?? "unknown";
    environment.CHRONOS_FINGERPRINT = job.fingerprint;
  }
  if (sandboxHandle?.profilePath !== undefined) {
    environment[CHRONOS_SEATBELT_PROFILE_ENV] = sandboxHandle.profilePath;
    environment[CHRONOS_SANDBOX_REQUIRED_ENV] = "1";
  }
  Object.assign(environment, job.definition.execution.environment.values);
  for (const name of job.definition.execution.environment.secretNames) {
    const value = options.secretResolver?.(name);
    if (value === undefined) {
      if (manifest?.ok) await manifestStore?.remove(manifest.value.path);
      await sandboxHandle?.close();
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: `Secret is unavailable: ${name}`,
        }),
      );
    }
    environment[name] = value;
    secretValues.push(value);
  }

  let child: ReturnType<typeof spawnChild>;
  try {
    child = spawnChild(executable, args, {
      cwd: job.definition.execution.workingDirectory,
      env: environment,
      stdin: buildChildContext(job, run),
    });
  } catch (cause) {
    if (manifest?.ok) await manifestStore?.remove(manifest.value.path);
    await sandboxHandle?.close();
    return err(
      new ChronosError({
        code: ChronosErrorCode.EXECUTOR_ERROR,
        message: "Failed to launch child executor",
        cause,
      }),
    );
  }
  let cancelled = false;
  let timedOut = false;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    child.terminate();
    forceTimer = setTimeout(() => child.kill(), options.graceMs ?? 5_000);
  };
  const cancel = () => {
    cancelled = true;
    terminate();
  };
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    terminate();
  }, job.definition.execution.timeoutMs);
  if (signal.aborted) cancel();
  const parser = new JsonlParser(20, job.definition.execution.maxOutputBytes);
  const stdoutTask = (async () => {
    try {
      for await (const chunk of child.stdout) parser.push(chunk);
    } catch (error) {
      if (!cancelled && !timedOut) throw error;
    }
  })();
  const stderrChunks: string[] = [];
  let stderrBytes = 0;
  const stderrLimit = job.definition.execution.maxOutputBytes;
  const stderrTask = (async () => {
    try {
      for await (const chunk of child.stderr) {
        stderrBytes += Buffer.byteLength(chunk);
        const retained = Buffer.byteLength(stderrChunks.join(""));
        if (retained < stderrLimit) {
          const remaining = stderrLimit - retained;
          stderrChunks.push(Buffer.from(chunk).subarray(0, remaining).toString("utf8"));
        }
      }
    } catch (error) {
      if (!cancelled && !timedOut) throw error;
    }
  })();
  const completed = await child.completed;
  await Promise.all([stdoutTask, stderrTask]);
  await sandboxHandle?.close();
  clearTimeout(timer);
  if (forceTimer !== undefined) clearTimeout(forceTimer);
  signal.removeEventListener("abort", cancel);
  if (manifest?.ok) await manifestStore?.remove(manifest.value.path);
  if (timedOut || cancelled) {
    if (child.pid > 0) child.kill();
  }
  const parsed = parser.finish();
  const redacted = redactText([parsed.assistantText, ...stderrChunks].join(""), [
    ...Object.values(job.definition.execution.environment.values),
    ...secretValues,
  ]);
  if (!redacted.ok) return redacted;
  const limited = limitOutput([redacted.value], job.definition.execution.maxOutputBytes);
  const retainedStderrBytes = Buffer.byteLength(stderrChunks.join(""));
  const outputTruncated =
    limited.truncated || parsed.textTruncated || stderrBytes > retainedStderrBytes;
  const outputSummary =
    outputTruncated && !limited.text.includes("[output truncated]")
      ? `${limited.text}\n[output truncated]`
      : limited.text;
  const completion = job.definition.execution.completion ?? { mode: "process_exit" as const };
  const requiredOutputs =
    completion.mode === "explicit"
      ? await Promise.all(
          completion.requiredOutputs.map(async (output) => {
            const allowed = await checkPathAllowed(
              output.path,
              job.definition.execution.workingDirectory,
              "write",
              job.definition.permissions,
            );
            if (!allowed.ok) return false;
            const target = allowed.value;
            const present = existsSync(target);
            return output.mutation === "atomic_replace"
              ? present &&
                  parsed.atomicWrites.some(
                    (written) =>
                      resolve(job.definition.execution.workingDirectory, written) === target,
                  )
              : present;
          }),
        )
      : undefined;
  let completionSummary: string | undefined;
  if (parsed.completion?.summary !== undefined) {
    const safeCompletion = redactText(parsed.completion.summary, [
      ...Object.values(job.definition.execution.environment.values),
      ...secretValues,
    ]);
    if (!safeCompletion.ok) return safeCompletion;
    completionSummary = safeCompletion.value.slice(0, 4_096);
  }
  const outcome = reduceTerminalOutcome({
    completion,
    exitCode: completed.exitCode,
    timedOut,
    cancelled,
    protocolFailure: parsed.protocolFailure || parsed.malformedLines > 0,
    completionDeclarations: parsed.completionDeclarations,
    completionStatus: parsed.completion?.status,
    requiredOutputs,
  });
  let output: RunOutput = {
    summary: outputSummary,
    truncated: outputTruncated,
    totalBytes: parsed.assistantTextBytes + stderrBytes,
    stopReason: parsed.stopReason,
    toolActivity: parsed.toolActivity,
    usage: { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens },
    completionSummary,
    completionCategory: outcome.category,
    toolErrorCount: parsed.toolErrorCount,
  };
  if (options.artifactDirectory !== undefined) {
    const artifact = await new ArtifactStore(options.artifactDirectory).write(
      run.id,
      redacted.value,
    );
    if (!artifact.ok) return artifact;
    output = { ...output, artifactPath: artifact.value };
  }
  return ok({
    status: outcome.status as SubagentResult["status"],
    output,
    errorCode: outcome.category,
    error:
      outcome.category === "command_failure"
        ? completed.stderr || outcome.message
        : (outcome.message ??
          (outcome.status === "failed"
            ? completed.stderr || "Child exited unsuccessfully"
            : undefined)),
  });
}

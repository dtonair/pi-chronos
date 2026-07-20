import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Job, UTCTimestamp } from "../domain/job.js";
import type { Run, RunOutput } from "../domain/run.js";
import { validateEnvironment } from "../security/environment-policy.js";
import { PolicyManifestStore } from "../security/policy-manifest.js";
import type { SandboxAdapter, SandboxHandle } from "../security/sandbox-adapter.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import { ArtifactStore } from "./artifact-store.js";
import { buildChildContext } from "./context-builder.js";
import { JsonlParser } from "./jsonl-parser.js";
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
  let executable = invocation.executable;
  let args = invocation.args;
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
    });
    if (!sandbox.ok) return sandbox;
    sandboxHandle = sandbox.value;
    const wrapped = sandboxHandle.wrapExecutable(executable, args);
    executable = wrapped.executable;
    args = [...wrapped.args];
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
  const environment: Record<string, string> = { PATH: process.env.PATH ?? "" };
  const secretValues: string[] = [];
  if (manifest?.ok) {
    environment.CHRONOS_POLICY_MANIFEST = manifest.value.path;
    environment.CHRONOS_RUN_ID = run.id;
    environment.CHRONOS_JOB_ID = job.id;
    environment.CHRONOS_OWNER_ID = options.ownerId ?? "unknown";
    environment.CHRONOS_FINGERPRINT = job.fingerprint;
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
  let output: RunOutput = {
    summary: outputSummary,
    truncated: outputTruncated,
    totalBytes: parsed.assistantTextBytes + stderrBytes,
    stopReason: parsed.stopReason,
    toolActivity: parsed.toolActivity,
    usage: { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens },
  };
  if (options.artifactDirectory !== undefined) {
    const artifact = await new ArtifactStore(options.artifactDirectory).write(
      run.id,
      redacted.value,
    );
    if (!artifact.ok) return artifact;
    output = { ...output, artifactPath: artifact.value };
  }
  if (timedOut) return ok({ status: "timed_out", output, error: "Execution timed out" });
  if (cancelled) return ok({ status: "cancelled", output, error: "Execution cancelled" });
  return ok({
    status: completed.exitCode === 0 ? "succeeded" : "failed",
    output,
    error: completed.exitCode === 0 ? undefined : completed.stderr || "Child exited unsuccessfully",
  });
}

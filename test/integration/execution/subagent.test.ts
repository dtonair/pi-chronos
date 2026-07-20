import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Job } from "../../../src/domain/job.js";
import type { Run } from "../../../src/domain/run.js";
import { executeSubagent } from "../../../src/execution/subagent-adapter.js";
import { createTestJob, createTestRun } from "../../fixtures/database.js";

const directories: string[] = [];

afterEach(async () => {
  const paths = directories.splice(0);
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
});

function jobWith(options: Partial<Job["definition"]["execution"]> = {}): Job {
  const job = createTestJob({ id: "job-exec" });
  job.definition.execution = { ...job.definition.execution, ...options };
  job.fingerprint = "a".repeat(64);
  return job;
}

describe("ephemeral child Pi execution", () => {
  it("passes context on stdin, parses JSONL, redacts output, and writes an artifact", async () => {
    const directory = await mkdtemp(join("/tmp", "chronos-child-"));
    directories.push(directory);
    const fakePi = join(directory, "pi");
    const stdinCapture = join(directory, "stdin.json");
    const argvCapture = join(directory, "argv.txt");
    await writeFile(
      fakePi,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$TEST_ARGV_CAPTURE"\ncat > "$TEST_STDIN_CAPTURE"\nprintf \'%s\\n\' \'{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"secret hello"}}\' \'{"type":"tool_execution_start","toolName":"read"}\' \'{"type":"message_end","message":{"usage":{"inputTokens":2,"outputTokens":3},"stopReason":"end"}}\'\n',
      { mode: 0o700 },
    );
    await chmod(fakePi, 0o700);
    const oldPath = process.env.PATH;
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    try {
      const job = jobWith({
        timeoutMs: 2_000,
        maxOutputBytes: 4_096,
        environment: {
          values: {
            SECRET_VALUE: "secret",
            TEST_STDIN_CAPTURE: stdinCapture,
            TEST_ARGV_CAPTURE: argvCapture,
          },
          secretNames: [],
        },
      });
      const run: Run = createTestRun({ id: "run-exec", jobId: job.id });
      const result = await executeSubagent(job, run, new AbortController().signal, {
        guardExtension: "/tmp/chronos-guard.js",
        ownerId: "instance-exec",
        manifestDirectory: join(directory, "manifests"),
        artifactDirectory: join(directory, "artifacts"),
        permissionMode: "pi-seatbelt-sandbox",
        piSeatbeltExtension: "/trusted/pi-seatbelt-sandbox",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("succeeded");
      expect(result.value.output?.summary).toContain("[REDACTED]");
      expect(result.value.output?.summary).not.toContain("secret");
      expect(result.value.output?.usage).toEqual({ inputTokens: 2, outputTokens: 3 });
      const childContext = JSON.parse(await readFile(stdinCapture, "utf8")) as {
        prompt: string;
        chronos: { runId: string };
      };
      expect(childContext.prompt).toBe(job.definition.prompt);
      expect(childContext.chronos.runId).toBe(run.id);
      const argv = (await readFile(argvCapture, "utf8")).trim().split("\n");
      expect(argv).toContain("read,grep,find,ls,edit,write,bash,chronos_complete");
      expect(argv).toContain("/trusted/pi-seatbelt-sandbox");
      expect(result.value.output?.artifactPath).toBeDefined();
      const artifactPath = result.value.output?.artifactPath ?? "";
      const artifact = await readFile(artifactPath, "utf8");
      expect(artifact).toContain("[REDACTED]");
      expect(artifact).not.toContain("secret");
      if (process.platform !== "win32") {
        expect((await stat(artifactPath)).mode & 0o077).toBe(0);
      }
      expect(await readdir(join(directory, "manifests"))).toHaveLength(0);
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("bounds malformed JSONL and preserves non-zero stderr diagnostics", async () => {
    const directory = await mkdtemp(join("/tmp", "chronos-child-malformed-"));
    directories.push(directory);
    const fakePi = join(directory, "pi");
    await writeFile(
      fakePi,
      "#!/bin/sh\nprintf 'not-json\\n' >&1; printf 'child-error\\n' >&2; exit 3\n",
      {
        mode: 0o700,
      },
    );
    await chmod(fakePi, 0o700);
    const oldPath = process.env.PATH;
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    try {
      const result = await executeSubagent(
        jobWith({ timeoutMs: 2_000 }),
        createTestRun({ id: "run-malformed", jobId: "job-exec" }),
        new AbortController().signal,
        { guardExtension: "/tmp/chronos-guard.js" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("failed");
        expect(result.value.error).toContain("child-error");
      }
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("terminates a child after its timeout and reports a timed-out outcome", async () => {
    const directory = await mkdtemp(join("/tmp", "chronos-child-timeout-"));
    directories.push(directory);
    const fakePi = join(directory, "pi");
    await writeFile(fakePi, "#!/bin/sh\nsleep 10\n", { mode: 0o700 });
    await chmod(fakePi, 0o700);
    const oldPath = process.env.PATH;
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    try {
      const result = await executeSubagent(
        jobWith({ timeoutMs: 20 }),
        createTestRun({ id: "run-timeout", jobId: "job-exec" }),
        new AbortController().signal,
        { guardExtension: "/tmp/chronos-guard.js", graceMs: 20 },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("timed_out");
    } finally {
      process.env.PATH = oldPath;
    }
  });

  it("terminates a child after cancellation and reports a cancelled outcome", async () => {
    const directory = await mkdtemp(join("/tmp", "chronos-child-cancel-"));
    directories.push(directory);
    const fakePi = join(directory, "pi");
    await writeFile(fakePi, "#!/bin/sh\nsleep 10\n", { mode: 0o700 });
    await chmod(fakePi, 0o700);
    const oldPath = process.env.PATH;
    process.env.PATH = `${directory}:${oldPath ?? ""}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      const result = await executeSubagent(
        jobWith({ timeoutMs: 2_000 }),
        createTestRun({ id: "run-cancel", jobId: "job-exec" }),
        controller.signal,
        { guardExtension: "/tmp/chronos-guard.js", graceMs: 20 },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.status).toBe("cancelled");
    } finally {
      clearTimeout(timer);
      process.env.PATH = oldPath;
    }
  });
});

import { open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decodeImportFile, type ImportFile } from "../api/schemas.js";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { ImportReconciliationResult } from "../domain/import.js";
import type { JobDefinition } from "../domain/job.js";
import { toCanonicalJSON } from "../security/canonical-json.js";
import { diffImportDefinitions } from "../security/import-diff.js";
import type { EventSink } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";
import type { createJobService } from "./job-service.js";

export interface ImportServiceOptions {
  jobService: ReturnType<typeof createJobService>;
  configDirName: string;
  maxBytes?: number;
  maxJobs?: number;
  events?: EventSink;
}

export async function importProjectJobs(
  options: ImportServiceOptions,
  projectRoot: string,
  actor: string,
  trustedProject: boolean,
): Promise<Result<ImportReconciliationResult>> {
  if (!trustedProject)
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: "Project is not trusted for import",
      }),
    );
  let identity: string;
  try {
    identity = await realpath(projectRoot);
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.IMPORT_SOURCE_MISSING,
        message: "Project root does not exist",
      }),
    );
  }
  const configRoot = join(identity, options.configDirName);
  const path = join(configRoot, "chronos.json");
  let safePath = path;
  try {
    const canonicalRoot = await realpath(configRoot);
    const canonicalFile = await realpath(path);
    if (
      canonicalRoot !== resolve(configRoot) ||
      (canonicalFile !== resolve(path) && !canonicalFile.startsWith(`${canonicalRoot}/`))
    ) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.PERMISSION_DENIED,
          message: "Import file resolves outside the trusted project configuration directory",
        }),
      );
    }
    safePath = canonicalFile;
  } catch {
    // The normal bounded read below maps missing paths to IMPORT_SOURCE_MISSING.
  }
  let raw: string;
  try {
    const maxBytes = options.maxBytes ?? 1_048_576;
    // Read at most maxBytes + 1 before parsing. This prevents an untrusted
    // project file from allocating an unbounded buffer just to reject it.
    const handle = await open(safePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(maxBytes + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.byteLength) {
        const chunk = await handle.read(
          buffer,
          bytesRead,
          buffer.byteLength - bytesRead,
          bytesRead,
        );
        if (chunk.bytesRead === 0) break;
        bytesRead += chunk.bytesRead;
      }
      if (bytesRead > maxBytes)
        return err(
          new ChronosError({
            code: ChronosErrorCode.OVERSIZED_INPUT,
            message: "Import file exceeds 1 MiB",
          }),
        );
      raw = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof ChronosError) return err(error);
    if (isMissingPathError(error)) {
      const disabled = disableMissingImportedJobs(options, identity, actor);
      if (!disabled.ok) return disabled;
      if (disabled.value > 0) {
        options.events?.emit({
          type: "import.disabled",
          timestamp: Date.now() as import("../domain/job.js").UTCTimestamp,
          payload: { project: identity, count: disabled.value, reason: "IMPORT_SOURCE_MISSING" },
        });
      }
    }
    return err(
      new ChronosError({
        code: ChronosErrorCode.IMPORT_SOURCE_MISSING,
        message: "Import file is missing",
        cause: error,
      }),
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err(
      new ChronosError({
        code: ChronosErrorCode.MALFORMED_JSON,
        message: "Import file is not valid JSON",
      }),
    );
  }
  const decoded = decodeImportFile(parsed);
  if (!decoded.ok) return decoded;
  if (decoded.value.jobs.length > (options.maxJobs ?? 1_000))
    return err(
      new ChronosError({
        code: ChronosErrorCode.OVERSIZED_INPUT,
        message: "Import contains too many jobs",
      }),
    );
  // Reconciliation, including its per-job audit records, is one durable
  // transaction. Repository mutations use savepoints when composed here.
  const result = options.jobService.transaction(() =>
    reconcile(options, decoded.value, identity, actor),
  );
  if (result.ok) {
    options.events?.emit({
      type: "import.reconciled",
      timestamp: Date.now() as import("../domain/job.js").UTCTimestamp,
      payload: {
        project: identity,
        created: result.value.created,
        updated: result.value.updated,
        unchanged: result.value.unchanged,
        disabled: result.value.disabled,
      },
    });
    if (result.value.disabled > 0) {
      options.events?.emit({
        type: "import.disabled",
        timestamp: Date.now() as import("../domain/job.js").UTCTimestamp,
        payload: { project: identity, count: result.value.disabled, reason: "SOURCE_MISSING" },
      });
    }
  }
  return result;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function disableMissingImportedJobs(
  options: ImportServiceOptions,
  identity: string,
  actor: string,
): Result<number> {
  return options.jobService.transaction(() => {
    const existingJobs: import("../domain/job.js").Job[] = [];
    let cursor: string | undefined;
    do {
      const page = options.jobService.listUserJobs({
        scope: "project",
        scopeKey: identity,
        cursor,
        limit: 100,
      });
      if (!page.ok) return page;
      existingJobs.push(...page.value.jobs);
      cursor = page.value.nextCursor;
    } while (cursor !== undefined);

    let disabled = 0;
    for (const job of existingJobs) {
      if (job.definition.source !== "project_import" || job.status === "disabled") continue;
      const result = options.jobService.disableJob(job.id, job.revision, actor);
      if (!result.ok) return result;
      disabled += 1;
    }
    return ok(disabled);
  });
}

function stableImportKey(identity: string, importKey: string): string {
  return JSON.stringify([identity, importKey]);
}

function reconcile(
  options: ImportServiceOptions,
  file: ImportFile,
  identity: string,
  actor: string,
): Result<ImportReconciliationResult> {
  const existingJobs = [] as import("../domain/job.js").Job[];
  let cursor: string | undefined;
  do {
    const page = options.jobService.listUserJobs({
      scope: "project",
      scopeKey: identity,
      cursor,
      limit: 100,
    });
    if (!page.ok) return page;
    existingJobs.push(...page.value.jobs);
    cursor = page.value.nextCursor;
  } while (cursor !== undefined);
  const existing = new Map(
    existingJobs
      .filter((job) => job.definition.source === "project_import" && job.definition.importKey)
      .map((job) => [job.definition.importKey as string, job]),
  );
  const seen = new Set<string>();
  const result: ImportReconciliationResult = {
    created: 0,
    unchanged: 0,
    updated: 0,
    disabled: 0,
    jobs: [],
    diffs: {},
  };
  for (const input of file.jobs) {
    const key = stableImportKey(identity, input.key);
    seen.add(key);
    const definition: Omit<JobDefinition, "model"> & { model: string } = {
      name: input.name,
      description: input.description,
      tags: input.tags ?? [],
      prompt: input.prompt,
      schedule: input.schedule,
      model: input.model,
      identity: { scope: "project", scopeKey: identity },
      execution: {
        ...input.execution,
        workingDirectory: input.execution?.workingDirectory ?? identity,
      } as JobDefinition["execution"],
      permissions: input.permissions as JobDefinition["permissions"],
      source: "project_import",
      importKey: key,
    };
    const old = existing.get(key);
    if (!old) {
      const created = options.jobService.createJob({
        definition,
        actor,
        allowPast: input.allowPast,
      });
      if (!created.ok) return created;
      result.created++;
      result.jobs.push(created.value.id);
      continue;
    }
    const candidate = {
      ...old.definition,
      name: definition.name,
      description: definition.description,
      tags: definition.tags,
      prompt: definition.prompt,
      schedule: definition.schedule,
      model: definition.model,
      identity: definition.identity,
      source: definition.source,
      importKey: definition.importKey,
      ...(input.execution === undefined ? {} : { execution: definition.execution }),
      ...(input.permissions === undefined ? {} : { permissions: definition.permissions }),
    };
    if (
      toCanonicalJSON(old.definition as unknown as Record<string, unknown>) ===
      toCanonicalJSON(candidate as unknown as Record<string, unknown>)
    ) {
      result.unchanged++;
      result.jobs.push(old.id);
      continue;
    }
    result.diffs[key] = diffImportDefinitions(
      old.definition as unknown as Record<string, unknown>,
      definition as unknown as Record<string, unknown>,
    );
    const updated = options.jobService.updateExistingJob({
      jobId: old.id,
      expectedRevision: old.revision,
      patch: definition,
      actor,
      allowPast: input.allowPast,
    });
    if (!updated.ok) return updated;
    result.updated++;
    result.jobs.push(old.id);
  }
  for (const old of existing.values()) {
    if (
      old.definition.importKey &&
      !seen.has(old.definition.importKey) &&
      old.status !== "disabled"
    ) {
      const disabled = options.jobService.disableJob(old.id, old.revision, actor);
      if (!disabled.ok) return disabled;
      result.disabled++;
    }
  }
  return ok(result);
}

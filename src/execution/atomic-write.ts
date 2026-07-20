import { randomBytes } from "node:crypto";
import { open, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobPermissions } from "../domain/permission.js";
import { checkPathAllowed } from "../security/path-policy.js";
import type { PathCanonicalizer } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export interface AtomicWriteResult {
  path: string;
  bytes: number;
  success: true;
}

export async function atomicWrite(
  path: string,
  content: string,
  options: {
    cwd: string;
    permissions: JobPermissions;
    maxBytes?: number;
    signal?: AbortSignal;
    canonicalizer?: PathCanonicalizer;
  },
): Promise<Result<AtomicWriteResult>> {
  if (Buffer.byteLength(content) > (options.maxBytes ?? 1_048_576))
    return failure("Atomic content exceeds the configured limit");
  if (options.signal?.aborted) return failure("Atomic write cancelled");
  const allowed = await checkPathAllowed(
    path,
    options.cwd,
    "write",
    options.permissions,
    options.canonicalizer,
  );
  if (!allowed.ok) return allowed;
  const target = allowed.value;
  try {
    const existing = await stat(target);
    if (existing.isDirectory()) return failure("Atomic target must be a file");
  } catch {
    // A new target is valid after its parent has been canonicalized.
  }
  const parent = dirname(resolve(options.cwd, path));
  let temporary: string | undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = `${resolve(parent, `.${randomBytes(16).toString("hex")}.chronos-tmp`)}`;
      try {
        handle = await open(candidate, "wx", 0o600);
        temporary = candidate;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 2) throw error;
      }
    }
    if (!handle || !temporary) throw new Error("Could not create temporary file");
    await handle.writeFile(content, "utf8");
    if (options.signal?.aborted) throw new Error("Atomic write cancelled");
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Recheck canonical policy immediately before replacing the target.
    const again = await checkPathAllowed(
      path,
      options.cwd,
      "write",
      options.permissions,
      options.canonicalizer,
    );
    if (!again.ok || again.value !== target) throw new Error("Atomic target changed");
    await rename(temporary, target);
    temporary = undefined;
    // Directory fsync is best-effort because support varies by filesystem.
    try {
      const directoryHandle = await open(dirname(target), "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
      // The file rename is already atomic; unsupported directory fsync does
      // not justify exposing a partial target or leaving a temp file.
    }
    return ok({ path: target, bytes: Buffer.byteLength(content), success: true });
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : "Atomic write failed");
  } finally {
    await handle?.close().catch(() => undefined);
    if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function failure(message: string): Result<never> {
  return err(new ChronosError({ code: ChronosErrorCode.PERMISSION_DENIED, message }));
}

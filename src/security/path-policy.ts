import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobPermissions } from "../domain/permission.js";
import type { PathCanonicalizer } from "../shared/ports.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export type PathOperation = "read" | "write";

export function lexicalCanonicalPath(path: string, cwd: string): string {
  return normalize(isAbsolute(path) ? path : resolve(cwd, path));
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root.endsWith("/") ? root : `${root}/`}`);
}

/** Resolve the target and nearest existing parent on every call. */
export async function checkPathAllowed(
  path: string,
  cwd: string,
  operation: PathOperation,
  permissions: JobPermissions,
  canonicalizer: PathCanonicalizer = nodePathCanonicalizer,
): Promise<Result<string>> {
  const requested = lexicalCanonicalPath(path, cwd);
  const roots =
    operation === "read" ? permissions.filesystem.readPaths : permissions.filesystem.writePaths;
  const canonicalRoots: string[] = [];
  for (const root of roots) {
    const lexical = lexicalCanonicalPath(root, cwd);
    try {
      canonicalRoots.push(await realpathWithNearestParent(lexical, canonicalizer));
    } catch {
      canonicalRoots.push(lexical);
    }
  }
  let target: string;
  try {
    target = await realpathWithNearestParent(requested, canonicalizer);
  } catch {
    return err(denied(`Cannot canonicalize path: ${path}`));
  }
  const allowed = canonicalRoots.some((root) => isWithin(target, root));
  return allowed ? ok(target) : err(denied(`Path is outside the ${operation} policy: ${path}`));
}

async function realpathWithNearestParent(
  requested: string,
  canonicalizer: PathCanonicalizer,
): Promise<string> {
  try {
    return await canonicalizer.realpath(requested);
  } catch {
    // New files do not have a realpath. Canonicalize the nearest existing
    // parent, then append the final relative component.
    let parent = dirname(requested);
    while (!(await canonicalizer.exists(parent))) {
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    return resolve(await canonicalizer.realpath(parent), requested.slice(parent.length + 1));
  }
}

function denied(message: string): ChronosError {
  return new ChronosError({ code: ChronosErrorCode.PERMISSION_DENIED, message });
}

export const nodePathCanonicalizer: PathCanonicalizer = {
  canonicalize: lexicalCanonicalPath,
  exists: async (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  realpath: (path) => realpath(path),
};

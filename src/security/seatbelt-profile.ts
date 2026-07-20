import { realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface SeatbeltProfileOptions {
  workingDirectory: string;
  readOnly: boolean;
  readPaths?: readonly string[];
  writePaths?: readonly string[];
  networkAllowed?: boolean;
  executable?: string;
  executablePaths?: readonly string[];
}

export interface SeatbeltProfileHandle {
  readonly path: string;
  readonly directory: string;
  close(): Promise<void>;
}

function quotePath(path: string): string {
  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Render only the reviewed baseline needed by a direct executable plus the
 * approved data roots. Seatbelt's network control is intentionally coarse.
 */
export function renderSeatbeltProfile(options: SeatbeltProfileOptions): string {
  const canonical = (path: string): string => {
    try {
      return realpathSync(path);
    } catch {
      return resolve(path);
    }
  };
  const reads = new Set(
    [
      "/usr",
      "/bin",
      "/sbin",
      "/System",
      "/Library",
      "/private/etc",
      "/private/var/db",
      "/dev",
      options.workingDirectory,
      ...(options.readPaths ?? []),
    ].map(canonical),
  );
  const writes = options.readOnly
    ? []
    : [options.workingDirectory, ...(options.writePaths ?? [])].map(canonical);
  const rules = [
    "(version 1)",
    "(deny default)",
    '(import "bsd.sb")',
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    ...[...reads].map((path) => `(allow file-read* (subpath ${quotePath(path)}))`),
    ...writes.map((path) => `(allow file-write* (subpath ${quotePath(path)}))`),
    ...[...(options.executable ? [options.executable] : []), ...(options.executablePaths ?? [])]
      .filter((path) => path.startsWith("/"))
      .map((path) => `(allow file-read* (literal ${quotePath(canonical(path))}))`),
    ...(options.networkAllowed === true ? ["(allow network*)"] : []),
  ];
  return rules.join(" ");
}

export async function createSeatbeltProfile(
  options: SeatbeltProfileOptions,
): Promise<SeatbeltProfileHandle> {
  const directory = await mkdtemp(join(tmpdir(), "chronos-seatbelt-"));
  const path = join(directory, "run.sb");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(path, renderSeatbeltProfile(options), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await chmod(path, 0o600);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  return {
    path,
    directory,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

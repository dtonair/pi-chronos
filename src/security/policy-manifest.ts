import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { UTCTimestamp } from "../domain/job.js";
import type { EffectivePermissions, PolicyManifest } from "../domain/permission.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export interface ManifestIdentity {
  runId: string;
  jobId: string;
  ownerId: string;
  fingerprint: string;
  permissions: EffectivePermissions;
}

export class PolicyManifestStore {
  private readonly consumed = new Set<string>();
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async create(
    identity: ManifestIdentity,
    now: UTCTimestamp,
    ttlMs: number,
  ): Promise<Result<{ manifest: PolicyManifest; path: string }>> {
    if (!/^[A-Za-z0-9_-]+$/.test(identity.runId) || !/^[A-Za-z0-9_-]+$/.test(identity.jobId)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.MANIFEST_INVALID,
          message: "Invalid manifest identity",
        }),
      );
    }
    const manifest: PolicyManifest = {
      schemaVersion: 1,
      nonce: randomUUID(),
      ...identity,
      issuedAt: now,
      expiresAt: (now + Math.max(1, ttlMs)) as UTCTimestamp,
    };
    const path = join(this.directory, `${manifest.runId}-${manifest.nonce}.json`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700).catch(() => undefined);
      await writeFile(path, `${JSON.stringify(manifest)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await chmod(path, 0o600).catch(() => undefined);
      return ok({ manifest, path });
    } catch (cause) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.DATABASE_ERROR,
          message: "Failed to create policy manifest",
          cause,
        }),
      );
    }
  }

  async readAndConsume(
    path: string,
    expected: Omit<ManifestIdentity, "permissions">,
    now: UTCTimestamp,
  ): Promise<Result<PolicyManifest>> {
    if (this.consumed.has(path))
      return err(
        new ChronosError({
          code: ChronosErrorCode.MANIFEST_REPLAY,
          message: "Policy manifest was already consumed",
        }),
      );
    const consumedPath = `${path}.consumed`;
    try {
      await stat(consumedPath);
      return err(
        new ChronosError({
          code: ChronosErrorCode.MANIFEST_REPLAY,
          message: "Policy manifest was already consumed",
        }),
      );
    } catch {
      // No durable consumed marker; claim the original path atomically below.
    }
    let retainConsumedMarker = false;
    try {
      // Rename is atomic on the supported filesystems, so two child starts
      // cannot both consume the same manifest between read and unlink.
      await rename(path, consumedPath);
      const info = await stat(consumedPath);
      if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.MANIFEST_INVALID,
            message: "Policy manifest is not private",
          }),
        );
      }
      const value: unknown = JSON.parse(await readFile(consumedPath, "utf8"));
      const manifest = value as Partial<PolicyManifest>;
      const topLevelKeys = new Set([
        "schemaVersion",
        "nonce",
        "runId",
        "jobId",
        "ownerId",
        "permissions",
        "fingerprint",
        "expiresAt",
        "issuedAt",
      ]);
      const permissions = manifest.permissions as Partial<EffectivePermissions> | undefined;
      const extensionIds = permissions?.extensions?.allowedIds;
      const validExtensionIds =
        Array.isArray(extensionIds) &&
        extensionIds.length <= 50 &&
        extensionIds.every(
          (item, index) =>
            typeof item === "string" &&
            item.length > 0 &&
            item.length <= 256 &&
            item.trim() === item &&
            !/[\0\r\n]/.test(item) &&
            extensionIds.indexOf(item) === index,
        );
      const broadPath = (item: unknown): boolean =>
        typeof item !== "string" ||
        item === "/" ||
        item === "\\\\" ||
        item === "." ||
        /^[A-Za-z]:[\\\\/]*$/.test(item);
      if (
        typeof value !== "object" ||
        value === null ||
        Object.keys(value).some((key) => !topLevelKeys.has(key)) ||
        manifest.schemaVersion !== 1 ||
        typeof manifest.nonce !== "string" ||
        manifest.nonce.length < 16 ||
        typeof manifest.issuedAt !== "number" ||
        typeof permissions !== "object" ||
        permissions === null ||
        !Array.isArray(permissions.tools) ||
        !Array.isArray(permissions.filesystem?.readPaths) ||
        !Array.isArray(permissions.filesystem?.writePaths) ||
        !validExtensionIds ||
        permissions.filesystem.readPaths.some(broadPath) ||
        permissions.filesystem.writePaths.some(broadPath) ||
        manifest.runId !== expected.runId ||
        manifest.jobId !== expected.jobId ||
        manifest.ownerId !== expected.ownerId ||
        manifest.fingerprint !== expected.fingerprint
      ) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.MANIFEST_INVALID,
            message: "Policy manifest identity does not match",
          }),
        );
      }
      if (
        typeof manifest.expiresAt !== "number" ||
        manifest.expiresAt <= now ||
        manifest.issuedAt > now ||
        manifest.expiresAt <= manifest.issuedAt
      ) {
        return err(
          new ChronosError({
            code: ChronosErrorCode.MANIFEST_EXPIRED,
            message: "Policy manifest has expired",
          }),
        );
      }
      this.consumed.add(path);
      retainConsumedMarker = true;
      return ok(manifest as PolicyManifest);
    } catch (cause) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.MANIFEST_INVALID,
          message: "Policy manifest is malformed",
          cause,
        }),
      );
    } finally {
      if (!retainConsumedMarker) await unlink(consumedPath).catch(() => undefined);
    }
  }

  async remove(path: string): Promise<void> {
    // Keep the consumed marker until explicit cleanup so a new store cannot
    // replay a manifest after the original path was atomically consumed.
    await unlink(path).catch(() => undefined);
    await unlink(`${path}.consumed`).catch(() => undefined);
  }
}

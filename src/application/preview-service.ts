/**
 * Preview and effective-permission calculation as side-effect-free application queries.
 *
 * Provides:
 *   - Schedule preview (normalized schedule + next 3 occurrences)
 *   - Effective permission calculation (resolved/permission policy)
 *
 * No persistence, no timers, no child processes.
 */

import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { JobSchedule, UTCTimestamp } from "../domain/job.js";
import type { EffectivePermissions, JobPermissions } from "../domain/permission.js";
import type { CronCalculator } from "../scheduler/cron.js";
import type { SchedulePreview } from "../scheduler/preview.js";
import { previewSchedule } from "../scheduler/preview.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

// ─── Preview service ────────────────────────────────────

export interface PreviewOptions {
  schedule: JobSchedule;
  clockNow: UTCTimestamp;
  cronCalc: CronCalculator;
}

/**
 * Preview a schedule: normalize and return next three UTC occurrences.
 */
export function previewJobSchedule(options: PreviewOptions): Result<SchedulePreview> {
  return previewSchedule(options.schedule, options.clockNow, options.cronCalc, "UTC");
}

// ─── Effective permissions ──────────────────────────────

/**
 * Calculate effective permissions from a stored JobPermissions block.
 *
 * Currently the effective permissions are a direct copy. Future phases
 * will add path canonicalization and environment resolution here.
 */
export function calculateEffectivePermissions(permissions: JobPermissions): EffectivePermissions {
  return {
    tools: [...permissions.tools],
    shell: { ...permissions.shell, commands: [...permissions.shell.commands] },
    filesystem: {
      ...permissions.filesystem,
      readPaths: [...permissions.filesystem.readPaths],
      writePaths: [...permissions.filesystem.writePaths],
    },
    network: { ...permissions.network, domains: [...permissions.network.domains] },
    extensions: { ...permissions.extensions, allowedIds: [...permissions.extensions.allowedIds] },
    secrets: { ...permissions.secrets, allowedNames: [...permissions.secrets.allowedNames] },
    canonicalReadPaths: [],
    canonicalWritePaths: [],
  };
}

/**
 * Validate that permissions are within supported bounds.
 */
export function validateEffectivePermissions(permissions: JobPermissions): Result<void> {
  const supported = new Set(["read", "grep", "find", "ls", "edit", "write", "bash"]);
  const unsupported = permissions.tools.find((tool) => !supported.has(tool));
  if (unsupported !== undefined) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.UNSUPPORTED_TOOL,
        message: `Unsupported scheduled tool: ${unsupported}`,
        entity: unsupported,
      }),
    );
  }
  const broadPath = (path: string): boolean =>
    path === "/" || path === "\\" || path === "." || /^[A-Za-z]:[\\\\/]*$/.test(path);
  if ([...permissions.filesystem.readPaths, ...permissions.filesystem.writePaths].some(broadPath)) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.PERMISSION_DENIED,
        message: "Filesystem policy cannot grant a filesystem root",
      }),
    );
  }
  if (permissions.extensions.allowedIds.length > 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.UNSUPPORTED_OPERATION,
        message: "Third-party extensions are not supported for scheduled jobs",
      }),
    );
  }
  if (!permissions.shell.allowed && permissions.shell.commands.length > 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: "Shell commands cannot be granted when shell access is disabled",
      }),
    );
  }
  if (!permissions.network.allowed && permissions.network.domains.length > 0) {
    return err(
      new ChronosError({
        code: ChronosErrorCode.VALIDATION_ERROR,
        message: "Network domains cannot be granted when network access is disabled",
      }),
    );
  }
  return ok(undefined);
}

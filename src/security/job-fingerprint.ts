/**
 * SHA-256 job fingerprint over the security-relevant fields.
 *
 * Security-relevant fields (FR61): any change to these invalidates approval.
 *   - name, prompt, schedule, model
 *   - execution: mode, workingDirectory, timeoutMs, maxOutputBytes,
 *                overlapPolicy, missedRunPolicy, sandboxRequired, completion, environment
 *   - permissions (all fields, including structured process rules)
 *   - source
 *
 * Display-only fields (do not affect fingerprint):
 *   - description, tags
 *
 * Structural/identity fields (not in fingerprint):
 *   - identity (scope, scopeKey) — scoped name uniqueness is enforced at the DB level
 *   - importKey
 */
import type { JobDefinition, JobEnvironment, JobExecution } from "../domain/job.js";
import type { JobPermissions } from "../domain/permission.js";
import { fingerprintSHA256 } from "./canonical-json.js";

// ─── Fingerprint target type ──────────────────────────
//
// The fingerprint is computed over a canonical subset of the job definition.
// This intermediate object is not stored — it only exists to be hashed.

export interface FingerprintTarget {
  name: string;
  prompt: string;
  schedule: unknown;
  model: string;
  execution: {
    mode: string;
    workingDirectory: string;
    timeoutMs: number;
    maxOutputBytes: number;
    overlapPolicy: string;
    missedRunPolicy: string;
    sandboxRequired: boolean;
    completion: JobExecution["completion"];
    environment: EnvironmentFingerprint;
  };
  permissions: PermissionsFingerprint;
  source: string;
}

interface EnvironmentFingerprint {
  values: Record<string, string>;
  secretNames: string[];
}

interface PermissionsFingerprint {
  tools: string[];
  shell: { allowed: boolean; commands: string[] };
  filesystem: { readPaths: string[]; writePaths: string[] };
  network: { allowed: boolean; domains: string[] };
  extensions: { allowedIds: string[] };
  secrets: { allowedNames: string[] };
  process: NonNullable<JobPermissions["process"]>;
}

/**
 * Extract the fingerprint target from a job definition.
 */
function toFingerprintTarget(def: JobDefinition): FingerprintTarget {
  return {
    name: def.name,
    prompt: def.prompt,
    schedule: def.schedule,
    model: def.model,
    execution: executionToTarget(def.execution),
    permissions: permissionsToTarget(def.permissions),
    source: def.source,
  };
}

function executionToTarget(exec: JobExecution): FingerprintTarget["execution"] {
  return {
    mode: exec.mode,
    workingDirectory: exec.workingDirectory,
    timeoutMs: exec.timeoutMs,
    maxOutputBytes: exec.maxOutputBytes,
    overlapPolicy: exec.overlapPolicy,
    missedRunPolicy: exec.missedRunPolicy,
    sandboxRequired: exec.sandboxRequired,
    // An omitted completion field is an input-side new-job default. Legacy
    // decoded rows carry an explicit process_exit value before fingerprinting.
    completion: exec.completion ?? { mode: "explicit", requiredOutputs: [] },
    environment: environmentToTarget(exec.environment),
  };
}

function environmentToTarget(env: JobEnvironment): EnvironmentFingerprint {
  return {
    values: { ...env.values },
    secretNames: [...env.secretNames],
  };
}

function permissionsToTarget(perms: JobPermissions): PermissionsFingerprint {
  return {
    tools: [...perms.tools],
    shell: {
      allowed: perms.shell.allowed,
      commands: [...perms.shell.commands],
    },
    filesystem: {
      readPaths: [...perms.filesystem.readPaths],
      writePaths: [...perms.filesystem.writePaths],
    },
    network: {
      allowed: perms.network.allowed,
      domains: [...perms.network.domains],
    },
    extensions: {
      allowedIds: [...perms.extensions.allowedIds],
    },
    secrets: {
      allowedNames: [...perms.secrets.allowedNames],
    },
    process: {
      allowed: perms.process?.allowed ?? false,
      commands: (perms.process?.commands ?? []).map((command) => ({
        executable: command.executable,
        args: command.args.map((arg) => ({ ...arg })),
      })),
    },
  };
}

// ─── Public API ──────────────────────────────────────

/**
 * Compute a SHA-256 fingerprint over the security-relevant fields of a job definition.
 *
 * Deterministic: identical security-relevant fields produce identical hashes
 * regardless of object key ordering or set-like array ordering.
 */
export function computeJobFingerprint(definition: JobDefinition): string {
  const target = toFingerprintTarget(definition);
  return fingerprintSHA256(target);
}

/**
 * Compare two fingerprints. Return true if they match.
 */
export function fingerprintsMatch(a: string, b: string): boolean {
  // Constant-time comparison to avoid timing attacks
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Check whether a job definition's current fingerprint matches a stored
 * approved fingerprint. If not, the approval has been invalidated.
 */
export function isFingerprintValid(
  approvedFingerprint: string,
  currentDefinition: JobDefinition,
): boolean {
  const currentFingerprint = computeJobFingerprint(currentDefinition);
  return fingerprintsMatch(approvedFingerprint, currentFingerprint);
}

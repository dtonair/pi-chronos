import type { UTCTimestamp } from "./job.js";

export type GuardSupportedTool = "read" | "grep" | "find" | "ls" | "edit" | "write" | "bash";

/** The approved permission policy persisted with every job. */
export interface JobPermissions {
  tools: string[];
  shell: {
    allowed: boolean;
    /** Exact complete command strings; no substring or regular-expression matching. */
    commands: string[];
  };
  filesystem: {
    readPaths: string[];
    writePaths: string[];
  };
  network: {
    allowed: boolean;
    domains: string[];
  };
  extensions: {
    /** Must remain empty in version 1. */
    allowedIds: string[];
  };
  secrets: {
    allowedNames: string[];
  };
}

export const DENY_ALL_PERMISSIONS: JobPermissions = {
  tools: [],
  shell: { allowed: false, commands: [] },
  filesystem: { readPaths: [], writePaths: [] },
  network: { allowed: false, domains: [] },
  extensions: { allowedIds: [] },
  secrets: { allowedNames: [] },
};

export interface EffectivePermissions extends JobPermissions {
  /** Canonical forms derived from filesystem policy at dispatch time. */
  canonicalReadPaths: string[];
  canonicalWritePaths: string[];
}

export interface PolicyManifest {
  schemaVersion: 1;
  nonce: string;
  runId: string;
  jobId: string;
  ownerId: string;
  permissions: EffectivePermissions;
  fingerprint: string;
  expiresAt: UTCTimestamp;
  issuedAt: UTCTimestamp;
}

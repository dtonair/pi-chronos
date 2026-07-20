import type { UTCTimestamp } from "./job.js";

export type GuardSupportedTool =
  | "read"
  | "grep"
  | "find"
  | "ls"
  | "edit"
  | "write"
  | "bash"
  | "chronos_exec"
  | "chronos_atomic_write"
  | "chronos_complete";

export type ProcessSlotType = "uuid" | "integer" | "slug";

export interface ProcessLiteralRule {
  kind: "literal";
  value: string;
}

export interface ProcessSlotRule {
  kind: "slot";
  name: string;
  valueType: ProcessSlotType;
}

export type ProcessArgumentRule = ProcessLiteralRule | ProcessSlotRule;

export interface ProcessCommandRule {
  executable: string;
  args: ProcessArgumentRule[];
}

export interface ProcessPermissions {
  allowed: boolean;
  commands: ProcessCommandRule[];
}

export type CompletionPolicy =
  | { mode: "process_exit" }
  | {
      mode: "explicit";
      requiredOutputs: Array<{ path: string; mutation: "atomic_replace" | "exists" }>;
    };

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
    /** Explicit Pi extension sources loaded after disabling ambient discovery. */
    allowedIds: string[];
  };
  secrets: {
    allowedNames: string[];
  };
  /** Structured argv execution is separate from exact Bash authorization. */
  /** Optional at the boundary for legacy callers; persisted/internal jobs normalize it. */
  process?: ProcessPermissions;
}

export const DENY_ALL_PERMISSIONS: JobPermissions = {
  tools: [],
  shell: { allowed: false, commands: [] },
  filesystem: { readPaths: [], writePaths: [] },
  network: { allowed: false, domains: [] },
  extensions: { allowedIds: [] },
  secrets: { allowedNames: [] },
  process: { allowed: false, commands: [] },
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

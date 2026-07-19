import type { UTCTimestamp } from "./job.js";

// ─── Path Permissions ─────────────────────

export type PathAccess = "read" | "write";

export interface PathRule {
  /** Canonical absolute path or glob-like prefix. */
  pattern: string;
  access: PathAccess;
}

// ─── Shell Command Policy ────────────────

/** Exact command string before any shell interpolation. Partial/substring matches rejected. */
export type ShellCommandPolicy = string;

// ─── Tool Policy ─────────────────

/** Built-in tool names that the guard recognizes. */
export type GuardSupportedTool = "read" | "write" | "edit" | "bash" | "ls" | "grep" | "find";

export interface ToolPolicy {
  /** Allowed built-in tools. Empty = none allowed (but the scheduler tool is always blocked). */
  allowedTools: readonly GuardSupportedTool[];
  /** Extension tool allowlist. Must be empty - not yet supported. */
  allowedExtensions: readonly string[];
}

// ─── Effective Permissions ──────────────

export interface EffectivePermissions {
  toolPolicy: ToolPolicy;
  readPaths: string[];
  writePaths: string[];
  shellCommands: ShellCommandPolicy[];
  envNames: string[];
  sandboxRequired: boolean;
}

// ─── Policy Manifest (for child process) ──

export interface PolicyManifest {
  /** Nonce to prevent replay. */
  nonce: string;
  /** Run this manifest authorizes. */
  runId: string;
  /** Job id this run belongs to. */
  jobId: string;
  /** Instance id of the owner scheduler. */
  ownerId: string;
  /** Effective permissions to enforce. */
  permissions: EffectivePermissions;
  /** The approved fingerprint at dispatch time. */
  fingerprint: string;
  /** Expiry timestamp after which the manifest is invalid. */
  expiresAt: UTCTimestamp;
  /** Manifest creation timestamp. */
  issuedAt: UTCTimestamp;
}

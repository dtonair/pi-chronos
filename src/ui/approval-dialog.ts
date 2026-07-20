import { Text } from "@earendil-works/pi-tui";
import type { ImportDiff } from "../security/import-diff.js";

export interface ApprovalDialogResult {
  confirmed: boolean;
  confirmationToken?: string;
}

export function approvalPrompt(fingerprint: string): string {
  return `Review fingerprint ${fingerprint} and confirm explicitly.`;
}

/** Compact, value-redacted approval diff suitable for TUI/RPC confirmation. */
/** Documented Pi TUI component for a bounded, redacted approval diff. */
export function createApprovalDiffView(diffs: readonly ImportDiff[], maxLines = 50): Text {
  return new Text(formatApprovalDiff(diffs, maxLines), 0, 0);
}

export function formatApprovalDiff(diffs: readonly ImportDiff[], maxLines = 50): string {
  const lines = diffs.slice(0, Math.max(0, maxLines)).map((diff) => {
    const before = diff.sensitive ? "[REDACTED]" : formatValue(diff.before);
    const after = diff.sensitive ? "[REDACTED]" : formatValue(diff.after);
    return `${diff.field}: ${before} -> ${after}${diff.sensitive ? " [sensitive]" : ""}`;
  });
  if (diffs.length > lines.length) lines.push(`[${diffs.length - lines.length} more changes]`);
  return lines.length === 0 ? "No definition changes." : lines.join("\n");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "[unavailable]";
  }
}

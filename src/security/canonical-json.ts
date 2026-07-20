/**
 * Deterministic canonical JSON builder for job fingerprinting.
 *
 * Normalization rules:
 *  1. Map keys are sorted alphabetically.
 *  2. Set-like arrays (tools, allowedIds, allowedNames, etc.) are sorted.
 *  3. Ordered content (prompts, descriptions, shell.commands list) preserves insertion order.
 *  4. Values that are null/undefined are omitted to prevent noise.
 *  5. Numeric values are serialized with fixed precision to avoid floating-point ambiguity.
 */
import { createHash } from "node:crypto";

export interface CanonicalJSONOptions {
  /** Set-like arrays whose element order should be normalized (sorted). */
  sortedArrays?: Set<string>;
  /** Omit fields with undefined/null values. */
  omitNullish?: boolean;
}

const DEFAULT_SORTED_ARRAYS = new Set([
  "tools",
  "allowedIds",
  "allowedNames",
  "readPaths",
  "writePaths",
  "secretNames",
  "domains",
]);

/**
 * Serialize a value to canonical JSON for deterministic fingerprinting.
 * Returns the canonical string representation.
 */
export function toCanonicalJSON(value: unknown, options: CanonicalJSONOptions = {}): string {
  const { sortedArrays = DEFAULT_SORTED_ARRAYS, omitNullish = true } = options;
  const seen = new WeakSet<object>();
  return serialize(value, sortedArrays, omitNullish, seen);
}

/**
 * Compute a SHA-256 fingerprint of a value using canonical JSON serialization.
 */
export function fingerprintSHA256(value: unknown, options: CanonicalJSONOptions = {}): string {
  const canonical = toCanonicalJSON(value, options);
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── Internal serialization ──────────────────────────

function serialize(
  value: unknown,
  sortedArrays: Set<string>,
  omitNullish: boolean,
  seen: WeakSet<object>,
  key?: string,
): string {
  if (omitNullish && (value === null || value === undefined)) {
    return key !== undefined ? "" : "null";
  }

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    // Normalize integer representation
    if (Number.isInteger(value)) return value.toFixed(0);
    return value.toFixed(6);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();

  // Array
  if (Array.isArray(value)) {
    // Check for circular reference
    if (seen.has(value)) return "null";
    seen.add(value);

    let entries: unknown[] = value;

    // Sort if this array is marked as a sorted array (set-like)
    if (key !== undefined && sortedArrays.has(key)) {
      entries = [...value].sort();
    }

    const items = entries
      .map((item) => serialize(item, sortedArrays, omitNullish, seen))
      .filter((s) => s !== "");
    return `[${items.join(",")}]`;
  }

  // Plain object
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) return "null";
    seen.add(value);

    const obj = value as Record<string, unknown>;
    // Sort keys alphabetically
    const sortedKeys = Object.keys(obj).sort();

    const pairs: string[] = [];
    for (const k of sortedKeys) {
      const s = serialize(obj[k], sortedArrays, omitNullish, seen, k);
      if (s !== "") {
        pairs.push(`${JSON.stringify(k)}:${s}`);
      }
    }
    return `{${pairs.join(",")}}`;
  }

  return "null";
}

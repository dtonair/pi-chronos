import type { IdGenerator } from "./ports.js";

/**
 * Crypto-random hex ID generator. 16 bytes -> 32 hex chars.
 */
export function createIdGenerator(): IdGenerator {
  return {
    length: 32,
    generate(): string {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    },
  };
}

/**
 * Deterministic test fake for reproducible IDs.
 */
export function createDeterministicIdGenerator(prefix = "test-"): IdGenerator {
  let counter = 0;
  return {
    length: 32,
    generate(): string {
      const seq = String(++counter).padStart(8, "0");
      return `${prefix}${seq}`;
    },
  };
}

import { randomUUID } from "node:crypto";
import type { IdGenerator } from "./ports.js";

/** UUID generator used for all persisted Chronos identities. */
export function createIdGenerator(): IdGenerator {
  return {
    length: 36,
    generate: randomUUID,
  };
}

export function createDeterministicIdGenerator(prefix = "test-"): IdGenerator {
  let counter = 0;
  return {
    length: 36,
    generate(): string {
      const seq = String(++counter).padStart(8, "0");
      return `${prefix}${seq}`;
    },
  };
}

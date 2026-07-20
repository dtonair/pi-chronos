import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export function redactText(text: string, secrets: readonly string[]): Result<string> {
  let output = text;
  for (const secret of secrets) {
    if (!secret) continue;
    output = output.split(secret).join("[REDACTED]");
    if (output.includes(secret)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.SECRET_REDACTION_FAILED,
          message: "Secret redaction failed",
        }),
      );
    }
  }
  return ok(output);
}

export function redactChunks(
  chunks: Iterable<string>,
  secrets: readonly string[],
): Result<string[]> {
  const output: string[] = [];
  for (const chunk of chunks) {
    const result = redactText(chunk, secrets);
    if (!result.ok) return result;
    output.push(result.value);
  }
  return ok(output);
}

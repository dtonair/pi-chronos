import { Buffer } from "node:buffer";

export interface LimitedOutput {
  text: string;
  totalBytes: number;
  truncated: boolean;
}

export function limitOutput(chunks: Iterable<string>, maxBytes: number): LimitedOutput {
  const limit = Math.max(0, maxBytes);
  let totalBytes = 0;
  let text = "";
  for (const chunk of chunks) {
    totalBytes += Buffer.byteLength(chunk);
    if (Buffer.byteLength(text) < limit) {
      const remaining = limit - Buffer.byteLength(text);
      text += Buffer.from(chunk).subarray(0, remaining).toString("utf8");
    }
  }
  const truncated = totalBytes > limit;
  return { text: truncated ? `${text}\n[output truncated]` : text, totalBytes, truncated };
}

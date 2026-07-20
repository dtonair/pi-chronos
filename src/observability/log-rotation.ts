import { rename, stat } from "node:fs/promises";

export async function rotateLog(path: string, maxBytes = 5 * 1024 * 1024): Promise<boolean> {
  try {
    const info = await stat(path);
    if (info.size <= maxBytes) return false;
    await rename(path, `${path}.1`);
    return true;
  } catch {
    return false;
  }
}

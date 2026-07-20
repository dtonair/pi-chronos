import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function createFilesystemTree() {
  const root = await mkdtemp(join(tmpdir(), "chronos-fs-"));
  await mkdir(join(root, "allowed"));
  await writeFile(join(root, "allowed", "file.txt"), "ok");
  await symlink(join(root, "allowed"), join(root, "link"));
  return { root };
}

import { mkdir, rm, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist", { recursive: true, force: true });
execFileSync("tsc", ["-p", "tsconfig.build.json"], { stdio: "inherit" });
await mkdir("dist/storage/schema", { recursive: true });
for (const name of ["001_initial.sql", "002_add_metadata_index.sql"]) {
  await copyFile(`src/storage/schema/${name}`, `dist/storage/schema/${name}`);
}

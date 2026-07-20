import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist/storage/schema", { recursive: true });
for (const name of ["001_initial.sql", "002_add_metadata_index.sql"]) {
  await copyFile(`src/storage/schema/${name}`, `dist/storage/schema/${name}`);
}

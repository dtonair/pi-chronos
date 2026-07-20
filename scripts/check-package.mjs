import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  env: { ...process.env, npm_config_cache: "/tmp/pi-chronos-npm-cache" },
});
const pack = JSON.parse(output)[0];
const files = pack.files.map((entry) => entry.path);
const forbidden = files.filter((file) =>
  /(^|\/)(test|coverage|\.git)(\/|$)|\.db$|\.log$|\.env$|\.map$/.test(file),
);
if (forbidden.length > 0) throw new Error(`Forbidden package files: ${forbidden.join(", ")}`);
for (const required of [
  "dist/index.js",
  "dist/extension/index.js",
  "dist/storage/schema/001_initial.sql",
  "dist/storage/schema/002_add_metadata_index.sql",
  "README.md",
  "LICENSE",
]) {
  if (!files.includes(required)) throw new Error(`Missing package file: ${required}`);
}
readFileSync("package.json");
console.log(`Package inspection passed (${files.length} files)`);

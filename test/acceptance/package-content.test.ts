import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("release package contents", () => {
  it("contains only the compiled runtime and required release assets", () => {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: "/tmp/pi-chronos-npm-cache" },
    });
    const files = (JSON.parse(output)[0]?.files ?? []).map((entry: { path: string }) => entry.path);
    const forbidden = files.filter((file: string) =>
      /(^|\/)(test|coverage|\.git)(\/|$)|\.db$|\.log$|\.env$|\.map$/.test(file),
    );
    expect(forbidden).toEqual([]);
    expect(files).toEqual(
      expect.arrayContaining([
        "dist/index.js",
        "dist/extension/index.js",
        "dist/storage/schema/001_initial.sql",
        "dist/storage/schema/002_add_metadata_index.sql",
        "README.md",
        "LICENSE",
      ]),
    );
  });
});

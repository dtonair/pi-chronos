import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";

const piExecutable = process.env.PI_EXECUTABLE ?? findPiExecutable();

describe("compiled Pi package", () => {
  it("contains the extension entry after build", () => {
    expect(existsSync("dist/extension/index.js")).toBe(true);
  });

  it("loads through Pi's offline JSON entry point without a model call", () => {
    expect(piExecutable).toBeDefined();
    if (piExecutable === undefined || !existsSync(piExecutable)) {
      throw new Error("A Pi executable is required for the offline package-load smoke test");
    }
    const result = spawnSync(
      piExecutable,
      [
        "--no-extensions",
        "-e",
        "./dist/extension/index.js",
        "--no-session",
        "--mode",
        "json",
        "-p",
        "/chronos status",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PI_OFFLINE: "1" },
        encoding: "utf8",
        shell: false,
        timeout: 30_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"type":"session"');
  });
});

function findPiExecutable(): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = `${directory}/pi`;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH without invoking a shell.
    }
  }
  return undefined;
}

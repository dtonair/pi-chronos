import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGlobalConfig } from "../../../src/config/load.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("global Chronos configuration", () => {
  it("uses defaults when the global file is missing", () => {
    expect(loadGlobalConfig("/definitely/missing/chronos-config.json").permissionMode).toBe("job");
  });

  it("loads a private trusted pi-seatbelt delegation", () => {
    const directory = mkdtempSync(join(tmpdir(), "chronos-config-"));
    directories.push(directory);
    const path = join(directory, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        permissionMode: "pi-seatbelt-sandbox",
        piSeatbeltExtension: "/trusted/pi-seatbelt-sandbox",
      }),
      { mode: 0o600 },
    );
    expect(loadGlobalConfig(path)).toMatchObject({
      permissionMode: "pi-seatbelt-sandbox",
      piSeatbeltExtension: "/trusted/pi-seatbelt-sandbox",
    });
  });

  it("rejects a global config writable by other users", () => {
    if (process.platform === "win32") return;
    const directory = mkdtempSync(join(tmpdir(), "chronos-config-"));
    directories.push(directory);
    const path = join(directory, "config.json");
    writeFileSync(path, "{}", { mode: 0o600 });
    chmodSync(path, 0o666);
    expect(() => loadGlobalConfig(path)).toThrow(/writable/);
  });
});

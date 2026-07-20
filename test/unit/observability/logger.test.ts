import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rotateLog } from "../../../src/observability/log-rotation.js";
import { createJsonlLogger } from "../../../src/observability/logger.js";

const clock = { now: () => 1_700_000_000_000 as never };

describe("structured logger", () => {
  it("rotates oversized logs without affecting scheduler code", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chronos-log-"));
    const path = join(directory, "chronos.log");
    try {
      await writeFile(path, "12345");
      expect(await rotateLog(path, 4)).toBe(true);
      expect(await readFile(`${path}.1`, "utf8")).toBe("12345");
      await expect(access(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("surfaces asynchronous write failures without throwing into scheduler code", async () => {
    const logger = createJsonlLogger("/proc/1/chronos.log", clock);
    expect(() => logger.info("event")).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(logger.lastError?.message).toBeDefined();
  });
});

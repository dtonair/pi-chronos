import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ChronosError, ChronosErrorCode } from "../domain/errors.js";
import type { Result } from "../shared/result.js";
import { err, ok } from "../shared/result.js";

export class ArtifactStore {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async write(runId: string, content: string): Promise<Result<string>> {
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.VALIDATION_ERROR,
          message: "Invalid run id for output artifact",
          entity: runId,
        }),
      );
    }
    const path = join(this.directory, `${runId}.log`);
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
      await chmod(path, 0o600).catch(() => undefined);
      return ok(path);
    } catch (cause) {
      return err(
        new ChronosError({
          code: ChronosErrorCode.DATABASE_ERROR,
          message: "Failed to write output artifact",
          cause,
        }),
      );
    }
  }
}

import { describe, expect, it } from "vitest";
import { ArtifactStore } from "../../../src/execution/artifact-store.js";

describe("private artifact store", () => {
  it("rejects path traversal identifiers and reports filesystem failures", async () => {
    const invalid = await new ArtifactStore("/tmp").write("../escape", "secret");
    expect(!invalid.ok && invalid.error.code).toBe("VALIDATION_ERROR");
    const failed = await new ArtifactStore("/proc/1").write("run-1", "secret");
    expect(!failed.ok && failed.error.code).toBe("DATABASE_ERROR");
  });
});

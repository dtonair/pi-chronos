import { describe, expect, it } from "vitest";
import { createApprovalDiffView, formatApprovalDiff } from "../../../src/ui/approval-dialog.js";

describe("approval diff presentation", () => {
  it("renders bounded redacted changes", () => {
    const text = formatApprovalDiff(
      [
        { field: "prompt", before: "secret old", after: "secret new", sensitive: true },
        { field: "description", before: "old", after: "new", sensitive: false },
      ],
      1,
    );
    expect(text).toContain("prompt: [REDACTED] -> [REDACTED] [sensitive]");
    expect(text).not.toContain("secret old");
    expect(text).toContain("[1 more changes]");
    expect(
      createApprovalDiffView([{ field: "x", before: "a", after: "b", sensitive: false }])
        .render(80)
        .join("\n"),
    ).toContain("x: a -> b");
  });
});

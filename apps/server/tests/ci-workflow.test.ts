import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("cross-platform CI supply-chain boundary", () => {
  it("grants only read access and pins every third-party action to a reviewed commit SHA", async () => {
    const workflow = await readFile(new URL("../../../.github/workflows/cross-platform.yml", import.meta.url), "utf8");

    expect(workflow).toMatch(/^permissions:\r?\n  contents: read$/m);
    expect(workflow).toContain("actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1");
    expect(workflow).toContain("pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0");
    expect(workflow).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0");
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/);
  });
});

import { describe, expect, it } from "vitest";
import type { ModelDigestSourceItem } from "@workbench/contracts";
import { formatTopTenSummary } from "../src/modules/model-digest/model-digest-summary";

const items: ModelDigestSourceItem[] = Array.from({ length: 12 }, (_, index) => ({
  sourceId: "huggingface", modelId: `author/model-${index + 1}`, name: `model-${index + 1}`,
  url: `https://huggingface.co/author/model-${index + 1}`, description: null,
  category: "Text Generation", metrics: {}, updatedAt: null
}));

describe("top ten model digest", () => {
  it("keeps the actual first ten in order and links only matched reporting", () => {
    const evidence = [{ modelId: items[0]!.modelId, cardExcerpt: "card", news: [
      { title: "Model 1 release", url: "https://example.com/report", publishedAt: null }
    ] }];
    const ai = JSON.stringify({
      descriptions: { "author/model-1": "这是一个文本生成模型。", "author/model-2": "用于问答。 额外的第二句话。" },
      sources: { "author/model-1": "https://example.com/report", "author/model-2": "https://unverified.test" },
      overview: "前十名涵盖不同用途。"
    });
    const summary = formatTopTenSummary(items, evidence, ai);
    expect(summary.match(/^\d+\. \[/gm)).toHaveLength(10);
    expect(summary.indexOf("author/model-1")).toBeLessThan(summary.indexOf("author/model-2"));
    expect(summary).not.toContain("author/model-11");
    expect(summary).toContain("[资料](<https://example.com/report>)");
    expect(summary).not.toContain("unverified.test");
    expect(summary).not.toContain("额外的第二句话");
    expect(summary).toContain("前十名涵盖不同用途。");
  });
});

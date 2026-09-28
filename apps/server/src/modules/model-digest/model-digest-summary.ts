import type { ModelDigestSourceItem } from "@workbench/contracts";

export interface ModelEvidence {
  modelId: string;
  cardExcerpt: string | null;
  news: Array<{ title: string; url: string; publishedAt: string | null }>;
}

function oneSentence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const plain = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!plain || plain.length > 180) return null;
  const sentence = plain.split(/(?<=[。！？])|(?<=[.!?])\s+/u)[0]?.trim();
  return sentence && sentence.length <= 120 ? sentence : null;
}

function fallbackDescription(item: ModelDigestSourceItem): string {
  const description = oneSentence(item.description);
  if (description) return description;
  return item.category ? `这是一个用于${item.category}任务的模型，详情请查看模型卡。` : "模型卡暂无足够信息，请打开模型页面查看详情。";
}

function parseResponse(content: string): Record<string, unknown> | null {
  try {
    const clean = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const result: unknown = JSON.parse(clean);
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  } catch { return null; }
}

/** Keep ranking, model links and output length under application control. */
export function formatTopTenSummary(items: ModelDigestSourceItem[], evidence: ModelEvidence[], aiContent: string): string {
  const topTen = items.slice(0, 10);
  const parsed = parseResponse(aiContent);
  const descriptions = parsed?.descriptions && typeof parsed.descriptions === "object" && !Array.isArray(parsed.descriptions)
    ? parsed.descriptions as Record<string, unknown> : {};
  const sources = parsed?.sources && typeof parsed.sources === "object" && !Array.isArray(parsed.sources)
    ? parsed.sources as Record<string, unknown> : {};
  const evidenceById = new Map(evidence.map((item) => [item.modelId, item]));
  const lines = topTen.map((item, index) => {
    const description = oneSentence(descriptions[item.modelId]) ?? fallbackDescription(item);
    const allowedNews = evidenceById.get(item.modelId)?.news ?? [];
    const source = allowedNews.find((news) => news.url === sources[item.modelId]);
    const externalSource = source && new URL(source.url).hostname !== "huggingface.co" ? source : null;
    return `${index + 1}. [${item.modelId}](<${item.url}>)：${description}${externalSource ? ` [资料](<${externalSource.url}>)` : ""}`;
  });
  const overview = typeof parsed?.overview === "string" ? parsed.overview.replace(/[\r\n]+/g, " ").trim().slice(0, 220) : "";
  return ["## Hugging Face 趋势榜前十", "", ...lines, "", "## 摘要", "", overview || "以上为本次 Hugging Face 社区趋势榜前十；榜单热度不代表模型能力排名。"].join("\n");
}

import type { ModelDigestSourceItem } from "@workbench/contracts";
import type { ModelEvidence } from "./model-digest-summary.js";

async function readPublicText(url: URL, timeoutMs: number, maxBytes: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "text/plain, application/json" } });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function cardExcerpt(markdown: string | null): string | null {
  if (!markdown) return null;
  const withoutFrontmatter = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
  const excerpt = withoutFrontmatter
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]*\)/g, (match) => match.slice(1, match.indexOf("]")))
    .replace(/[#*`|>]+/g, " ")
    .replace(/\s+/g, " ").trim();
  return excerpt ? excerpt.slice(0, 1_500) : null;
}

interface NewsArticle { title?: unknown; url?: unknown; seendate?: unknown }

function matchKey(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }

function matchingHackerNews(payload: string | null, modelId: string): ModelEvidence["news"] {
  if (!payload) return [];
  let hits: Array<{ title?: unknown; url?: unknown; created_at?: unknown }>;
  try {
    const parsed = JSON.parse(payload) as { hits?: unknown };
    hits = Array.isArray(parsed.hits) ? parsed.hits : [];
  } catch { return []; }
  const key = matchKey(modelId.split("/")[1] ?? "");
  if (key.length < 6) return [];
  return hits.flatMap((hit) => {
    if (typeof hit.title !== "string" || typeof hit.url !== "string") return [];
    if (!matchKey(`${hit.title} ${hit.url}`).includes(key)) return [];
    try {
      const url = new URL(hit.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return [];
      return [{ title: hit.title.trim().slice(0, 220), url: url.href,
        publishedAt: typeof hit.created_at === "string" ? hit.created_at : null }];
    } catch { return []; }
  }).slice(0, 2);
}

function matchingNews(payload: string | null, modelId: string): ModelEvidence["news"] {
  if (!payload) return [];
  let articles: NewsArticle[];
  try {
    const parsed = JSON.parse(payload) as { articles?: unknown };
    articles = Array.isArray(parsed.articles) ? parsed.articles : [];
  } catch { return []; }
  const modelName = modelId.split("/")[1]?.toLowerCase() ?? "";
  if (modelName.length < 6) return [];
  return articles.flatMap((article) => {
    if (typeof article.title !== "string" || typeof article.url !== "string") return [];
    const title = article.title.trim().slice(0, 220);
    if (!matchKey(title).includes(matchKey(modelName))) return [];
    try {
      const url = new URL(article.url);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return [];
      return [{ title, url: url.href, publishedAt: typeof article.seendate === "string" ? article.seendate : null }];
    } catch { return []; }
  }).slice(0, 2);
}

/** Public model cards and optional news coverage; a news outage never blocks the digest. */
export async function fetchModelEvidence(items: ModelDigestSourceItem[]): Promise<ModelEvidence[]> {
  return Promise.all(items.slice(0, 10).map(async (item) => {
    const cardUrl = new URL(`${item.url}/raw/main/README.md`);
    const modelName = item.modelId.split("/")[1] ?? item.modelId;
    const newsUrl = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    newsUrl.searchParams.set("query", `"${modelName}"`);
    newsUrl.searchParams.set("mode", "artlist");
    newsUrl.searchParams.set("format", "json");
    newsUrl.searchParams.set("maxrecords", "8");
    newsUrl.searchParams.set("timespan", "3months");
    const communityUrl = new URL("https://hn.algolia.com/api/v1/search");
    communityUrl.searchParams.set("query", `"${modelName}"`);
    communityUrl.searchParams.set("tags", "story");
    communityUrl.searchParams.set("hitsPerPage", "5");
    const [card, news, community] = await Promise.all([
      readPublicText(cardUrl, 7_000, 100_000),
      readPublicText(newsUrl, 5_000, 100_000),
      readPublicText(communityUrl, 5_000, 100_000)
    ]);
    return { modelId: item.modelId, cardExcerpt: cardExcerpt(card),
      news: [...matchingHackerNews(community, item.modelId), ...matchingNews(news, item.modelId)].slice(0, 3) };
  }));
}

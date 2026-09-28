import type { ModelDigestSourceSnapshot, ModelDigestSourceItem } from "@workbench/contracts";
import { ModelDigestSourceSnapshotSchema } from "@workbench/contracts";
import { isoDate, ModelSourceError, numericMetric, readSourceJson, textMetric } from "./source-http.js";

const maxModels = 20;
const safeModelId = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function modelUrl(id: string): string {
  return `https://huggingface.co/${id.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeModel(value: unknown): ModelDigestSourceItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = textMetric(row.id, 300) ?? textMetric(row.modelId, 300);
  if (!id || !safeModelId.test(id)) return null;
  const card = row.cardData && typeof row.cardData === "object" ? row.cardData as Record<string, unknown> : {};
  const description = textMetric(card.summary, 2_000) ?? textMetric(card.description, 2_000) ?? null;
  const metrics: Record<string, string | number> = {};
  const trendingScore = numericMetric(row.trendingScore);
  const likes = numericMetric(row.likes);
  const downloads = numericMetric(row.downloads);
  if (trendingScore !== undefined) metrics.trendingScore = trendingScore;
  if (likes !== undefined) metrics.likes = likes;
  if (downloads !== undefined) metrics.downloads = downloads;
  return {
    sourceId: "huggingface",
    modelId: id,
    name: textMetric(card.name, 300) ?? id,
    url: modelUrl(id),
    description,
    category: textMetric(row.pipeline_tag, 120) ?? null,
    metrics,
    updatedAt: isoDate(row.lastModified)
  };
}

export async function fetchHuggingFaceTrending(signal?: AbortSignal): Promise<ModelDigestSourceSnapshot> {
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("sort", "trendingScore");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(maxModels));
  for (const field of ["cardData", "pipeline_tag", "downloads", "likes", "lastModified", "trendingScore"]) {
    url.searchParams.append("expand[]", field);
  }
  let payload: unknown;
  try { payload = await readSourceJson(url, signal); }
  catch (error) {
    if (error instanceof ModelSourceError) throw new ModelSourceError(error.category, "huggingface", error.transportCode);
    throw error;
  }
  if (!Array.isArray(payload)) throw new ModelSourceError("invalid_response", "huggingface");
  const items = payload.slice(0, maxModels).map(normalizeModel).filter((item): item is ModelDigestSourceItem => item !== null);
  if (items.length === 0) throw new ModelSourceError("invalid_response", "huggingface");
  return ModelDigestSourceSnapshotSchema.parse({ sourceId: "huggingface", fetchedAt: new Date().toISOString(), items });
}

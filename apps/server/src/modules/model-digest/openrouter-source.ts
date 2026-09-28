import type { ModelDigestSourceSnapshot, ModelDigestSourceItem } from "@workbench/contracts";
import { ModelDigestSourceSnapshotSchema } from "@workbench/contracts";
import { ModelSourceError, numericMetric, readSourceJson, textMetric } from "./source-http.js";

const maxModels = 20;
const safeModelId = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:+-]+$/;

function normalizeModel(value: unknown, index: number): ModelDigestSourceItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = textMetric(row.id, 300);
  if (!id || !safeModelId.test(id)) return null;
  const architecture = row.architecture && typeof row.architecture === "object" ? row.architecture as Record<string, unknown> : {};
  const metrics: Record<string, string | number> = { weeklyRank: index + 1 };
  const contextLength = numericMetric(row.context_length);
  if (contextLength !== undefined) metrics.contextLength = contextLength;
  const pricing = row.pricing && typeof row.pricing === "object" ? row.pricing as Record<string, unknown> : {};
  const inputPrice = numericMetric(pricing.prompt);
  const outputPrice = numericMetric(pricing.completion);
  if (inputPrice !== undefined) metrics.inputPricePerTokenUsd = inputPrice;
  if (outputPrice !== undefined) metrics.outputPricePerTokenUsd = outputPrice;
  return {
    sourceId: "openrouter",
    modelId: id,
    name: textMetric(row.name, 300) ?? id,
    url: `https://openrouter.ai/${id.split("/").map(encodeURIComponent).join("/")}`,
    description: textMetric(row.description, 2_000) ?? null,
    category: textMetric(architecture.modality, 120) ?? null,
    metrics,
    updatedAt: null
  };
}

export async function fetchOpenRouterTopWeekly(signal?: AbortSignal): Promise<ModelDigestSourceSnapshot> {
  const url = new URL("https://openrouter.ai/api/v1/models");
  url.searchParams.set("sort", "top-weekly");
  url.searchParams.set("limit", String(maxModels));
  let payload: unknown;
  try { payload = await readSourceJson(url, signal); }
  catch (error) {
    if (error instanceof ModelSourceError) throw new ModelSourceError(error.category, "openrouter", error.transportCode);
    throw error;
  }
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).data)) {
    throw new ModelSourceError("invalid_response", "openrouter");
  }
  const data = (payload as { data: unknown[] }).data;
  const items = data.slice(0, maxModels).map(normalizeModel).filter((item): item is ModelDigestSourceItem => item !== null);
  if (items.length === 0) throw new ModelSourceError("invalid_response", "openrouter");
  return ModelDigestSourceSnapshotSchema.parse({ sourceId: "openrouter", fetchedAt: new Date().toISOString(), items });
}

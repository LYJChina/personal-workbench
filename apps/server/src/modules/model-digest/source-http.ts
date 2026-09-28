export type ModelSourceFailureCategory = "timeout" | "network" | "rate_limit" | "upstream" | "invalid_response";
export type ModelDigestSourceName = "huggingface" | "openrouter";

export class ModelSourceError extends Error {
  public constructor(
    public readonly category: ModelSourceFailureCategory,
    public readonly source?: ModelDigestSourceName,
    public readonly transportCode?: string
  ) {
    super("Model source request failed");
    this.name = "ModelSourceError";
  }
}

function safeTransportCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^[A-Z0-9_]{1,64}$/i.test(value.code)) return value.code;
    current = value.cause;
  }
  return undefined;
}

const maxResponseBytes = 1_000_000;
const sourceTimeoutMs = 12_000;

export async function readSourceJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, sourceTimeoutMs);
  timer.unref?.();
  try {
    signal?.throwIfAborted();
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (response.status === 429) throw new ModelSourceError("rate_limit");
    if (!response.ok) throw new ModelSourceError("upstream");
    const advertised = Number(response.headers.get("content-length"));
    if (Number.isFinite(advertised) && advertised > maxResponseBytes) throw new ModelSourceError("invalid_response");
    if (!response.body) throw new ModelSourceError("invalid_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new ModelSourceError("invalid_response");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch { throw new ModelSourceError("invalid_response"); }
  } catch (error) {
    if (error instanceof ModelSourceError) throw error;
    if (signal?.aborted) throw new ModelSourceError("network");
    if (controller.signal.aborted) throw new ModelSourceError("timeout");
    throw new ModelSourceError("network", undefined, safeTransportCode(error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function numericMetric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function textMetric(value: unknown, maxLength = 2_000): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maxLength) : undefined;
}

export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

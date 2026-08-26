import type { AiConnectionRecord } from "./ai-connection.repository.js";
import {
  AiGatewayError,
  categoryForStatus,
  providerUrl,
  type AiCompletionInput,
  type AiCompletionResult,
  type AiProviderAdapter
} from "./ai-gateway.types.js";

interface OpenAiResponse {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class OpenAiAdapter implements AiProviderAdapter {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async complete(connection: AiConnectionRecord, apiKey: string, input: AiCompletionInput): Promise<AiCompletionResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 30_000);
    try {
      const response = await this.fetchImplementation(providerUrl(connection.baseUrl, "chat/completions"), {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: connection.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.7,
          max_tokens: input.maxTokens ?? 2_000
        }),
        signal: controller.signal,
        redirect: "manual"
      });
      if (!response.ok || (response.status >= 300 && response.status < 400)) {
        throw new AiGatewayError(categoryForStatus(response.status));
      }
      const payload = await response.json() as OpenAiResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim() || typeof payload.model !== "string" || !payload.model.trim()) {
        throw new AiGatewayError("upstream");
      }
      return { content: content.trim(), model: payload.model.trim() };
    } catch (error) {
      if (error instanceof AiGatewayError) throw error;
      if ((error as { name?: string } | null)?.name === "AbortError") throw new AiGatewayError("timeout");
      throw new AiGatewayError("network");
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
  }
}

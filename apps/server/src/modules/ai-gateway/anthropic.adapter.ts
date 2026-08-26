import type { AiConnectionRecord } from "./ai-connection.repository.js";
import {
  AiGatewayError,
  categoryForStatus,
  providerUrl,
  type AiCompletionInput,
  type AiCompletionResult,
  type AiProviderAdapter
} from "./ai-gateway.types.js";

interface AnthropicResponse {
  model?: unknown;
  content?: Array<{ type?: unknown; text?: unknown }>;
}

export class AnthropicAdapter implements AiProviderAdapter {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async complete(connection: AiConnectionRecord, apiKey: string, input: AiCompletionInput): Promise<AiCompletionResult> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 30_000);
    const system = input.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const messages = input.messages
      .filter((message): message is typeof message & { role: "user" | "assistant" } => message.role !== "system")
      .map(({ role, content }) => ({ role, content }));
    try {
      const response = await this.fetchImplementation(providerUrl(connection.baseUrl, "messages"), {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: connection.model,
          ...(system ? { system } : {}),
          messages,
          temperature: input.temperature ?? 0.7,
          max_tokens: input.maxTokens ?? 2_000
        }),
        signal: controller.signal,
        redirect: "manual"
      });
      if (!response.ok || (response.status >= 300 && response.status < 400)) {
        throw new AiGatewayError(categoryForStatus(response.status));
      }
      const payload = await response.json() as AnthropicResponse;
      const text = payload.content?.find((block) => block.type === "text" && typeof block.text === "string" && block.text.trim());
      if (!text || typeof text.text !== "string" || typeof payload.model !== "string" || !payload.model.trim()) {
        throw new AiGatewayError("upstream");
      }
      return { content: text.text.trim(), model: payload.model.trim() };
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

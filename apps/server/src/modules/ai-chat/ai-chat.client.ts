import type { AiChatRole } from "@workbench/contracts";

export type AiChatFailureCategory = "auth" | "rate_limit" | "timeout" | "upstream";

export class AiChatClientError extends Error {
  public constructor(public readonly category: AiChatFailureCategory) {
    super("AI chat request failed");
    this.name = "AiChatClientError";
  }
}

export interface AiChatContextMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatGenerationInput {
  baseUrl: string;
  model: string;
  apiKey: string;
  messages: AiChatContextMessage[];
  signal?: AbortSignal;
}

export interface AiChatGenerator {
  generate(input: AiChatGenerationInput): Promise<{ content: string; model: string }>;
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class AiChatClient implements AiChatGenerator {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async generate(input: AiChatGenerationInput): Promise<{ content: string; model: string }> {
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort();
    input.signal?.addEventListener("abort", abortFromRequest, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetchImplementation(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.model, messages: input.messages, temperature: 0.7, max_tokens: 2_000 }),
        signal: controller.signal,
        redirect: "manual"
      });
      if (response.status === 401 || response.status === 403) throw new AiChatClientError("auth");
      if (response.status === 429) throw new AiChatClientError("rate_limit");
      if (!response.ok || (response.status >= 300 && response.status < 400)) throw new AiChatClientError("upstream");
      const payload = await response.json() as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      const model = payload.model;
      if (typeof content !== "string" || !content.trim() || typeof model !== "string" || !model.trim()) throw new AiChatClientError("upstream");
      return { content: content.trim(), model: model.trim() };
    } catch (error) {
      if (error instanceof AiChatClientError) throw error;
      if ((error as { name?: string } | null)?.name === "AbortError") throw new AiChatClientError("timeout");
      throw new AiChatClientError("upstream");
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromRequest);
    }
  }
}

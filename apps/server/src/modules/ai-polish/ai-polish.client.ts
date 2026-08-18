import type { AiPolishInput, AiSystemPromptInput } from "@workbench/contracts";
import { buildAiPolishMessages, buildSystemPromptMessages } from "./ai-polish.prompt.js";
import { DeepSeekClientError } from "../daily-reports/deepseek.client.js";
import type { ChatMessage } from "../daily-reports/daily-report.prompt.js";

export interface AiPolishGenerationInput extends AiPolishInput {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AiSystemPromptGenerationInput extends AiSystemPromptInput {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface AiPolishGenerator {
  generatePolish(input: AiPolishGenerationInput): Promise<{ content: string; model: string }>;
  generateSystemPrompt(input: AiSystemPromptGenerationInput): Promise<{ prompt: string; model: string }>;
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

export class AiPolishClient implements AiPolishGenerator {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async generatePolish(input: AiPolishGenerationInput): Promise<{ content: string; model: string }> {
    const generated = await this.complete(input, buildAiPolishMessages(input), 0.2);
    return { content: generated.content, model: generated.model };
  }

  public async generateSystemPrompt(input: AiSystemPromptGenerationInput): Promise<{ prompt: string; model: string }> {
    const generated = await this.complete(input, buildSystemPromptMessages(input.goal), 0.3);
    return { prompt: generated.content, model: generated.model };
  }

  private async complete(input: { baseUrl: string; model: string; apiKey: string }, messages: ChatMessage[], temperature: number): Promise<{ content: string; model: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetchImplementation(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.model, messages, temperature }),
        signal: controller.signal,
        redirect: "manual"
      });
      if (response.status === 401 || response.status === 403) throw new DeepSeekClientError("auth");
      if (response.status === 429) throw new DeepSeekClientError("rate_limit");
      if (!response.ok || (response.status >= 300 && response.status < 400)) throw new DeepSeekClientError("upstream");
      const payload = await response.json() as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      const model = payload.model;
      if (typeof content !== "string" || !content.trim() || typeof model !== "string" || !model.trim()) throw new DeepSeekClientError("upstream");
      return { content: content.trim(), model: model.trim() };
    } catch (error) {
      if (error instanceof DeepSeekClientError) throw error;
      if ((error as { name?: string } | null)?.name === "AbortError") throw new DeepSeekClientError("timeout");
      throw new DeepSeekClientError("upstream");
    } finally {
      clearTimeout(timeout);
    }
  }
}

import type { DailyReportInput } from "@workbench/contracts";
import { buildDailyReportMessages } from "./daily-report.prompt.js";

export type DeepSeekFailureCategory = "auth" | "rate_limit" | "timeout" | "upstream";

export class DeepSeekClientError extends Error {
  public constructor(public readonly category: DeepSeekFailureCategory) {
    super("DeepSeek request failed");
    this.name = "DeepSeekClientError";
  }
}

export interface DailyReportGenerationInput extends DailyReportInput {
  baseUrl: string;
  model: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface DailyReportGenerator {
  generateDailyReport(input: DailyReportGenerationInput): Promise<{ content: string; model: string }>;
}

interface ChatCompletionResponse {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

const requestTimeoutMs = 30_000;

export class DeepSeekClient implements DailyReportGenerator {
  public constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  public async generateDailyReport(input: DailyReportGenerationInput): Promise<{ content: string; model: string }> {
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort();
    input.signal?.addEventListener("abort", abortFromRequest, { once: true });
    if (input.signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await this.fetchImplementation(`${input.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: input.model,
          messages: buildDailyReportMessages(input),
          temperature: 0.2
        }),
        signal: controller.signal,
        redirect: "manual"
      });

      if (response.status === 401 || response.status === 403) throw new DeepSeekClientError("auth");
      if (response.status === 429) throw new DeepSeekClientError("rate_limit");
      if (response.status >= 300 && response.status < 400) throw new DeepSeekClientError("upstream");
      if (!response.ok) throw new DeepSeekClientError("upstream");

      let payload: ChatCompletionResponse;
      try {
        payload = await response.json() as ChatCompletionResponse;
      } catch {
        throw new DeepSeekClientError("upstream");
      }
      const content = payload.choices?.[0]?.message?.content;
      const model = payload.model;
      if (typeof content !== "string" || !content.trim() || typeof model !== "string" || !model.trim()) {
        throw new DeepSeekClientError("upstream");
      }
      return { content: content.trim(), model: model.trim() };
    } catch (error) {
      if (error instanceof DeepSeekClientError) throw error;
      if ((error as { name?: string } | null)?.name === "AbortError") throw new DeepSeekClientError("timeout");
      throw new DeepSeekClientError("upstream");
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abortFromRequest);
    }
  }
}

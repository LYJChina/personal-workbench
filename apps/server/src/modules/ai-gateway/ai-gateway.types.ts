import type { AiConnectionRecord } from "./ai-connection.repository.js";

export type AiGatewayFailureCategory =
  | "not_configured"
  | "auth"
  | "billing"
  | "invalid_request"
  | "rate_limit"
  | "timeout"
  | "network"
  | "upstream";

export class AiGatewayError extends Error {
  public constructor(public readonly category: AiGatewayFailureCategory) {
    super("AI provider request failed");
    this.name = "AiGatewayError";
  }
}

export interface AiGatewayMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionInput {
  messages: AiGatewayMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AiCompletionResult {
  content: string;
  model: string;
}

export interface AiProviderAdapter {
  complete(connection: AiConnectionRecord, apiKey: string, input: AiCompletionInput): Promise<AiCompletionResult>;
}

export function providerUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

export function categoryForStatus(status: number): AiGatewayFailureCategory {
  if (status === 400 || status === 404 || status === 422) return "invalid_request";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "billing";
  if (status === 429) return "rate_limit";
  return "upstream";
}

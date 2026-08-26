import type { Response } from "express";
import { AiGatewayError, type AiGatewayFailureCategory } from "./ai-gateway.types.js";

const failures: Record<AiGatewayFailureCategory, { status: number; message: string; code: string }> = {
  not_configured: { status: 409, message: "请先在设置中配置模型服务", code: "AI_NOT_CONFIGURED" },
  auth: { status: 401, message: "模型服务身份验证失败，请检查 API Key", code: "AI_AUTH_FAILED" },
  billing: { status: 402, message: "模型服务账户余额不足或计费不可用", code: "AI_BILLING_FAILED" },
  invalid_request: { status: 400, message: "模型服务拒绝了请求，请检查模型配置", code: "AI_INVALID_REQUEST" },
  rate_limit: { status: 429, message: "模型请求过于频繁，请稍后重试", code: "AI_RATE_LIMITED" },
  timeout: { status: 504, message: "模型响应超时，请稍后重试", code: "AI_TIMEOUT" },
  network: { status: 502, message: "无法连接到模型服务，请检查网络和 API 地址", code: "AI_NETWORK_ERROR" },
  upstream: { status: 502, message: "模型服务暂时不可用，请稍后重试", code: "AI_UPSTREAM_ERROR" }
};

export function sendAiGatewayError(response: Response, error: unknown): void {
  const category = error instanceof AiGatewayError ? error.category : "upstream";
  const failure = failures[category];
  response.status(failure.status).json({ error: { message: failure.message, code: failure.code } });
}

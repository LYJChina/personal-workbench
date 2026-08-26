import { randomUUID } from "node:crypto";
import {
  AiConnectionCreateSchema,
  AiConnectionIdSchema,
  AiConnectionUpdateSchema
} from "@workbench/contracts";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { SecretStore } from "../../platform/secret-store.js";
import { bindRequestLifecycle, requestCanContinue } from "../../http/request-lifecycle.js";
import { isAllowedDeepSeekUrl } from "../settings/settings.routes.js";
import { AiGatewayError } from "./ai-gateway.types.js";
import {
  AiConnectionRepository,
  aiConnectionNotFoundError,
  defaultAiConnectionError,
  finalAiConnectionError,
  publicAiConnection,
  type AiConnectionRecord
} from "./ai-connection.repository.js";

interface AiConnectionRouterDependencies {
  repository: AiConnectionRepository;
  secretStore: SecretStore;
  allowLoopbackHttp?: boolean;
  idFactory?: () => string;
  tester: (id: string, signal: AbortSignal) => Promise<void>;
}

const validationResponse = { error: { message: "AI connection validation failed", code: "VALIDATION_ERROR" } } as const;
const notFoundResponse = { error: { message: "AI connection not found", code: "AI_CONNECTION_NOT_FOUND" } } as const;
const finalConnectionResponse = { error: { message: "At least one AI connection is required", code: "AI_CONNECTION_REQUIRED" } } as const;
const defaultConnectionResponse = { error: { message: "Switch the default AI connection before deleting it", code: "AI_CONNECTION_IS_DEFAULT" } } as const;
const testMessages = {
  success: { status: "success", message: "连接成功" },
  auth_failure: { status: "auth_failure", message: "身份验证失败，请检查凭据" },
  billing_failure: { status: "billing_failure", message: "服务商账户余额不足或计费不可用" },
  invalid_request: { status: "invalid_request", message: "服务商拒绝了请求，请检查模型名称和 API 地址" },
  rate_limit: { status: "rate_limit", message: "请求过于频繁或额度已受限，请稍后重试" },
  timeout: { status: "timeout", message: "连接超时，请稍后重试" },
  unreachable_host: { status: "unreachable_host", message: "无法连接到服务商服务器，请检查网络和 API 地址" },
  provider_error: { status: "provider_error", message: "服务商暂时异常，请稍后重试" }
} as const;

function validUrl(raw: unknown, parsed: string, allowLoopbackHttp: boolean): boolean {
  return raw === parsed && isAllowedDeepSeekUrl(parsed, allowLoopbackHttp);
}

function handle(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
}

async function publicRecord(record: AiConnectionRecord, secretStore: SecretStore) {
  return publicAiConnection(record, Boolean(await secretStore.readSecret(record.secretName)));
}

export function createAiConnectionRouter(dependencies: AiConnectionRouterDependencies): Router {
  const router = Router();
  const allowLoopbackHttp = Boolean(dependencies.allowLoopbackHttp);
  const idFactory = dependencies.idFactory ?? randomUUID;

  router.get("/settings/ai-connections", handle(async (_request, response) => {
    response.json(await Promise.all(dependencies.repository.list().map((record) => publicRecord(record, dependencies.secretStore))));
  }));

  router.post("/settings/ai-connections", handle(async (request, response) => {
    const parsed = AiConnectionCreateSchema.safeParse(request.body);
    if (!parsed.success || !validUrl(request.body?.baseUrl, parsed.data.baseUrl, allowLoopbackHttp)) {
      response.status(400).json(validationResponse);
      return;
    }
    const id = AiConnectionIdSchema.parse(idFactory());
    const secretName = `ai-connection:${id}:api-key`;
    const replacement = parsed.data.apiKey?.trim();
    const record = dependencies.repository.create(id, parsed.data);
    try {
      if (replacement) await dependencies.secretStore.protectSecret(secretName, replacement);
    } catch (error) {
      dependencies.repository.delete(id);
      throw error;
    }
    response.status(201).json(await publicRecord(record, dependencies.secretStore));
  }));

  router.put("/settings/ai-connections/:id", handle(async (request, response) => {
    const id = String(request.params.id);
    if (!AiConnectionIdSchema.safeParse(id).success || !dependencies.repository.get(id)) {
      response.status(404).json(notFoundResponse);
      return;
    }
    const parsed = AiConnectionUpdateSchema.safeParse(request.body);
    if (!parsed.success || !validUrl(request.body?.baseUrl, parsed.data.baseUrl, allowLoopbackHttp)) {
      response.status(400).json(validationResponse);
      return;
    }
    const existing = dependencies.repository.get(id)!;
    const replacement = parsed.data.apiKey?.trim();
    const previousSecret = replacement ? await dependencies.secretStore.readSecret(existing.secretName) : null;
    if (replacement) await dependencies.secretStore.protectSecret(existing.secretName, replacement);
    let updated: AiConnectionRecord;
    try {
      updated = dependencies.repository.update(id, parsed.data);
    } catch (error) {
      if (replacement) {
        if (previousSecret) await dependencies.secretStore.protectSecret(existing.secretName, previousSecret);
        else await dependencies.secretStore.deleteSecret(existing.secretName);
      }
      throw error;
    }
    response.json(await publicRecord(updated, dependencies.secretStore));
  }));

  router.put("/settings/ai-connections/:id/default", handle(async (request, response) => {
    const id = String(request.params.id);
    if (!AiConnectionIdSchema.safeParse(id).success || !dependencies.repository.get(id)) {
      response.status(404).json(notFoundResponse);
      return;
    }
    response.json(await publicRecord(dependencies.repository.setDefault(id), dependencies.secretStore));
  }));

  router.post("/settings/ai-connections/:id/test", handle(async (request, response) => {
    const id = String(request.params.id);
    if (!AiConnectionIdSchema.safeParse(id).success || !dependencies.repository.get(id)) {
      response.status(404).json(notFoundResponse);
      return;
    }
    const signal = bindRequestLifecycle(request, response, () => undefined);
    try {
      await dependencies.tester(id, signal);
      if (requestCanContinue(request, response, signal)) response.json(testMessages.success);
    } catch (error) {
      if (!requestCanContinue(request, response, signal)) return;
      const category = error instanceof AiGatewayError ? error.category : "upstream";
      if (category === "auth") response.json(testMessages.auth_failure);
      else if (category === "billing") response.json(testMessages.billing_failure);
      else if (category === "invalid_request") response.json(testMessages.invalid_request);
      else if (category === "rate_limit") response.json(testMessages.rate_limit);
      else if (category === "timeout") response.json(testMessages.timeout);
      else if (category === "network") response.json(testMessages.unreachable_host);
      else response.json(testMessages.provider_error);
    }
  }));

  router.delete("/settings/ai-connections/:id", handle(async (request, response) => {
    const id = String(request.params.id);
    if (!AiConnectionIdSchema.safeParse(id).success || !dependencies.repository.get(id)) {
      response.status(404).json(notFoundResponse);
      return;
    }
    try {
      const existing = dependencies.repository.assertDeletable(id);
      const previousSecret = await dependencies.secretStore.readSecret(existing.secretName);
      await dependencies.secretStore.deleteSecret(existing.secretName);
      try {
        dependencies.repository.delete(id);
      } catch (error) {
        if (previousSecret) await dependencies.secretStore.protectSecret(existing.secretName, previousSecret);
        throw error;
      }
      response.status(204).end();
    } catch (error) {
      if (error instanceof Error && error.message === finalAiConnectionError) {
        response.status(409).json(finalConnectionResponse);
        return;
      }
      if (error instanceof Error && error.message === defaultAiConnectionError) {
        response.status(409).json(defaultConnectionResponse);
        return;
      }
      if (error instanceof Error && error.message === aiConnectionNotFoundError) {
        response.status(404).json(notFoundResponse);
        return;
      }
      throw error;
    }
  }));

  return router;
}

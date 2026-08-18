import { Router, type NextFunction, type Request, type Response } from "express";
import { AiPolishInputSchema, AiPolishKindSchema, AiPolishPromptUpdateSchema, AiPolishUpdateSchema, AiSystemPromptInputSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { SecretStore } from "../../platform/dpapi.js";
import { DeepSeekClientError } from "../daily-reports/deepseek.client.js";
import { isAllowedDeepSeekUrl } from "../settings/settings.routes.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import type { AiPolishGenerator } from "./ai-polish.client.js";
import { AiPolishRepository } from "./ai-polish.repository.js";

const deepSeekSecretName = "deepseek-api-key";

function errorResponse(response: Response, status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function providerError(response: Response, error: unknown): void {
  const category = error instanceof DeepSeekClientError ? error.category : "upstream";
  if (category === "auth") return errorResponse(response, 401, "DeepSeek 身份验证失败", "DEEPSEEK_AUTH_FAILED");
  if (category === "rate_limit") return errorResponse(response, 429, "DeepSeek 请求过于频繁，请稍后重试", "DEEPSEEK_RATE_LIMITED");
  if (category === "timeout") return errorResponse(response, 504, "DeepSeek 请求超时，请稍后重试", "DEEPSEEK_TIMEOUT");
  return errorResponse(response, 502, "DeepSeek 服务暂时不可用", "DEEPSEEK_UPSTREAM_ERROR");
}

export function createAiPolishRouter(paths: AppPaths, dependencies: {
  secretStore: SecretStore;
  generator: AiPolishGenerator;
  allowLoopbackHttp?: boolean;
}): Router {
  const router = Router();
  router.use((_request, response, next) => {
    const database = openDatabase(paths);
    response.locals.aiPolishRepository = new AiPolishRepository(database);
    response.locals.settingsRepository = new SettingsRepository(database);
    response.once("finish", () => database.close());
    next();
  });
  const recordsFor = (response: Response) => response.locals.aiPolishRepository as AiPolishRepository;
  const settingsFor = (response: Response) => response.locals.settingsRepository as SettingsRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

  router.post("/ai-polish/generate", handle(async (request, response) => {
    const parsed = AiPolishInputSchema.safeParse(request.body);
    if (!parsed.success) return errorResponse(response, 400, "AI polish validation failed", "VALIDATION_ERROR");
    const apiKey = await dependencies.secretStore.readSecret(deepSeekSecretName);
    const settings = settingsFor(response).getDeepSeekSettings(Boolean(apiKey));
    if (!apiKey || !settings.model.trim() || !isAllowedDeepSeekUrl(settings.baseUrl, Boolean(dependencies.allowLoopbackHttp))) {
      return errorResponse(response, 409, "请先在设置中配置 DeepSeek", "DEEPSEEK_NOT_CONFIGURED");
    }
    let generated: { content: string; model: string };
    try {
      generated = await dependencies.generator.generatePolish({ ...parsed.data, baseUrl: settings.baseUrl, model: settings.model, apiKey });
    } catch (error) {
      providerError(response, error);
      return;
    }
    response.status(201).json(recordsFor(response).create(parsed.data, generated));
  }));

  router.post("/ai-polish/system-prompt", handle(async (request, response) => {
    const parsed = AiSystemPromptInputSchema.safeParse(request.body);
    if (!parsed.success) return errorResponse(response, 400, "System prompt validation failed", "VALIDATION_ERROR");
    const apiKey = await dependencies.secretStore.readSecret(deepSeekSecretName);
    const settings = settingsFor(response).getDeepSeekSettings(Boolean(apiKey));
    if (!apiKey || !settings.model.trim() || !isAllowedDeepSeekUrl(settings.baseUrl, Boolean(dependencies.allowLoopbackHttp))) {
      return errorResponse(response, 409, "请先在设置中配置 DeepSeek", "DEEPSEEK_NOT_CONFIGURED");
    }
    try {
      const generated = await dependencies.generator.generateSystemPrompt({ ...parsed.data, baseUrl: settings.baseUrl, model: settings.model, apiKey });
      response.json(generated);
    } catch (error) {
      providerError(response, error);
    }
  }));

  router.get("/ai-polish", (_request, response) => response.json(recordsFor(response).list()));

  router.get("/ai-polish/prompts", (_request, response) => response.json(recordsFor(response).listPrompts()));

  router.put("/ai-polish/prompts/:kind", (request, response) => {
    const kind = AiPolishKindSchema.safeParse(request.params.kind);
    const prompt = AiPolishPromptUpdateSchema.safeParse(request.body);
    if (!kind.success || !prompt.success) return errorResponse(response, 400, "AI polish prompt validation failed", "VALIDATION_ERROR");
    response.json(recordsFor(response).savePrompt(kind.data, prompt.data.systemPrompt));
  });

  router.put("/ai-polish/:id", (request, response) => {
    const id = parseId(request.params.id);
    const parsed = AiPolishUpdateSchema.safeParse(request.body);
    if (id === null || !parsed.success) return errorResponse(response, 400, "AI polish validation failed", "VALIDATION_ERROR");
    const record = recordsFor(response).updateContent(id, parsed.data.content);
    if (!record) return errorResponse(response, 404, "AI polish record not found", "NOT_FOUND");
    response.json(record);
  });

  return router;
}

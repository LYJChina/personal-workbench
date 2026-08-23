import { Router, type NextFunction, type Request, type Response } from "express";
import { AiChatInputSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { SecretStore } from "../../platform/secret-store.js";
import { isAllowedDeepSeekUrl } from "../settings/settings.routes.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { AiChatClientError, type AiChatGenerator, type AiChatContextMessage } from "./ai-chat.client.js";
import { AiChatRepository } from "./ai-chat.repository.js";

const deepSeekSecretName = "deepseek-api-key";
const maximumContextMessages = 20;
const maximumContextCharacters = 30_000;

export interface AiChatRouterDependencies {
  secretStore: SecretStore;
  generator: AiChatGenerator;
  allowLoopbackHttp?: boolean;
}

function boundedContext(messages: AiChatContextMessage[]): AiChatContextMessage[] {
  const selected: AiChatContextMessage[] = [];
  let characters = 0;
  for (const message of messages.slice(-maximumContextMessages).reverse()) {
    if (selected.length > 0 && characters + message.content.length > maximumContextCharacters) break;
    const remaining = maximumContextCharacters - characters;
    selected.push({ ...message, content: message.content.slice(-remaining) });
    characters += Math.min(message.content.length, remaining);
    if (characters >= maximumContextCharacters) break;
  }
  selected.reverse();
  while (selected[0]?.role === "assistant") selected.shift();
  return selected;
}

function generationFailure(response: Response, error: unknown): void {
  const category = error instanceof AiChatClientError ? error.category : "upstream";
  const messages = {
    auth: "模型身份验证失败，请检查 API Key",
    rate_limit: "模型请求过于频繁，请稍后再试",
    timeout: "模型响应超时，请稍后再试",
    upstream: "模型暂时无法响应，请稍后再试"
  } as const;
  response.status(502).json({ error: { message: messages[category], code: `AI_${category.toUpperCase()}` } });
}

export function createAiChatRouter(paths: AppPaths, dependencies: AiChatRouterDependencies): Router {
  const router = Router();

  router.use((_request, response, next) => {
    const database = openDatabase(paths);
    response.locals.aiChatRepository = new AiChatRepository(database);
    response.locals.aiChatSettingsRepository = new SettingsRepository(database);
    response.once("finish", () => database.close());
    next();
  });

  const repositoryFor = (response: Response) => response.locals.aiChatRepository as AiChatRepository;
  const settingsFor = (response: Response) => response.locals.aiChatSettingsRepository as SettingsRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

  router.get("/ai-chat/messages", (_request, response) => response.json(repositoryFor(response).list()));

  router.post("/ai-chat/messages", handle(async (request, response) => {
    const parsed = AiChatInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { message: "请输入要发送的问题", code: "VALIDATION_ERROR" } });
      return;
    }
    const apiKey = await dependencies.secretStore.readSecret(deepSeekSecretName);
    const settings = settingsFor(response).getDeepSeekSettings(Boolean(apiKey));
    if (!apiKey || !isAllowedDeepSeekUrl(settings.baseUrl, Boolean(dependencies.allowLoopbackHttp))) {
      response.status(400).json({ error: { message: "请先在设置中配置大模型 API", code: "NOT_CONFIGURED" } });
      return;
    }

    const repository = repositoryFor(response);
    repository.create("user", parsed.data.content, null);
    const context = boundedContext(repository.list().map(({ role, content }) => ({ role, content })));
    try {
      const generated = await dependencies.generator.generate({
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey,
        messages: context
      });
      response.status(201).json(repository.create("assistant", generated.content, generated.model));
    } catch (error) {
      generationFailure(response, error);
    }
  }));

  router.delete("/ai-chat/messages", (_request, response) => {
    repositoryFor(response).clear();
    response.status(204).end();
  });

  return router;
}

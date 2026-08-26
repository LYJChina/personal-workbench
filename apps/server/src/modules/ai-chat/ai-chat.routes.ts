import { Router, type NextFunction, type Request, type Response } from "express";
import { AiChatInputSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { AiGateway } from "../ai-gateway/ai-gateway.js";
import { sendAiGatewayError } from "../ai-gateway/ai-gateway.http.js";
import type { AiGatewayMessage } from "../ai-gateway/ai-gateway.types.js";
import { AiChatRepository } from "./ai-chat.repository.js";
import { AiPersonaRepository } from "./ai-persona.repository.js";
import { bindRequestLifecycle, requestCanContinue } from "../../http/request-lifecycle.js";

const maximumContextMessages = 20;
const maximumContextCharacters = 30_000;

export interface AiChatRouterDependencies {
  gateway: Pick<AiGateway, "complete">;
}

function boundedContext(messages: AiGatewayMessage[]): AiGatewayMessage[] {
  const selected: AiGatewayMessage[] = [];
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

export function createAiChatRouter(paths: AppPaths, dependencies: AiChatRouterDependencies): Router {
  const router = Router();

  router.use((request, response, next) => {
    const database = openDatabase(paths);
    response.locals.aiChatRepository = new AiChatRepository(database);
    response.locals.aiPersonaRepository = new AiPersonaRepository(database);
    response.locals.requestSignal = bindRequestLifecycle(request, response, () => database.close());
    next();
  });

  const repositoryFor = (response: Response) => response.locals.aiChatRepository as AiChatRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

  router.get("/ai-chat/messages", (_request, response) => response.json(repositoryFor(response).list()));

  router.post("/ai-chat/messages", handle(async (request, response) => {
    const signal = response.locals.requestSignal as AbortSignal;
    const parsed = AiChatInputSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { message: "请输入要发送的问题", code: "VALIDATION_ERROR" } });
      return;
    }
    const repository = repositoryFor(response);
    repository.create("user", parsed.data.content, null);
    const persona = (response.locals.aiPersonaRepository as AiPersonaRepository).get();
    const systemPrompt = [persona.personalityPrompt, persona.profilePortrait ? `用户画像：${persona.profilePortrait}` : "", persona.systemPrompt].filter(Boolean).join("\n\n");
    const context = boundedContext(repository.list().map(({ role, content }) => ({ role, content })));
    if (systemPrompt) context.unshift({ role: "system", content: systemPrompt });
    try {
      const generated = await dependencies.gateway.complete({
        messages: context,
        temperature: 0.7,
        maxTokens: 2_000,
        signal
      });
      if (!requestCanContinue(request, response, signal)) return;
      response.status(201).json(repository.create("assistant", generated.content, generated.model));
    } catch (error) {
      if (requestCanContinue(request, response, signal)) sendAiGatewayError(response, error);
    }
  }));

  router.delete("/ai-chat/messages", (_request, response) => {
    repositoryFor(response).clear();
    response.status(204).end();
  });

  return router;
}

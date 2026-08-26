import { Router, type NextFunction, type Request, type Response } from "express";
import { AiPolishInputSchema, AiPolishKindSchema, AiPolishPromptUpdateSchema, AiPolishUpdateSchema, AiSystemPromptInputSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { AiGateway } from "../ai-gateway/ai-gateway.js";
import { sendAiGatewayError } from "../ai-gateway/ai-gateway.http.js";
import { buildAiPolishMessages, buildSystemPromptMessages } from "./ai-polish.prompt.js";
import { AiPolishRepository } from "./ai-polish.repository.js";
import { bindRequestLifecycle, requestCanContinue } from "../../http/request-lifecycle.js";

function errorResponse(response: Response, status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function createAiPolishRouter(paths: AppPaths, dependencies: {
  gateway: Pick<AiGateway, "complete">;
}): Router {
  const router = Router();
  router.use((request, response, next) => {
    const database = openDatabase(paths);
    response.locals.aiPolishRepository = new AiPolishRepository(database);
    response.locals.requestSignal = bindRequestLifecycle(request, response, () => database.close());
    next();
  });
  const recordsFor = (response: Response) => response.locals.aiPolishRepository as AiPolishRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

  router.post("/ai-polish/generate", handle(async (request, response) => {
    const signal = response.locals.requestSignal as AbortSignal;
    const parsed = AiPolishInputSchema.safeParse(request.body);
    if (!parsed.success) return errorResponse(response, 400, "AI polish validation failed", "VALIDATION_ERROR");
    let generated: { content: string; model: string };
    try {
      generated = await dependencies.gateway.complete({ messages: buildAiPolishMessages(parsed.data), temperature: 0.2, signal });
    } catch (error) {
      if (requestCanContinue(request, response, signal)) sendAiGatewayError(response, error);
      return;
    }
    if (requestCanContinue(request, response, signal)) response.status(201).json(recordsFor(response).create(parsed.data, generated));
  }));

  router.post("/ai-polish/system-prompt", handle(async (request, response) => {
    const signal = response.locals.requestSignal as AbortSignal;
    const parsed = AiSystemPromptInputSchema.safeParse(request.body);
    if (!parsed.success) return errorResponse(response, 400, "System prompt validation failed", "VALIDATION_ERROR");
    try {
      const generated = await dependencies.gateway.complete({ messages: buildSystemPromptMessages(parsed.data.goal), temperature: 0.3, signal });
      if (requestCanContinue(request, response, signal)) response.json({ prompt: generated.content, model: generated.model });
    } catch (error) {
      if (requestCanContinue(request, response, signal)) sendAiGatewayError(response, error);
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

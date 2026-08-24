import { Router, type NextFunction, type Request, type Response } from "express";
import { DailyReportInputSchema, DailyReportUpdateSchema, type DailyReport } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { SecretStore } from "../../platform/secret-store.js";
import { isAllowedDeepSeekUrl } from "../settings/settings.routes.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { DailyReportRepository } from "./daily-report.repository.js";
import { DeepSeekClientError, type DailyReportGenerator } from "./deepseek.client.js";
import { bindRequestLifecycle, requestCanContinue } from "../../http/request-lifecycle.js";

const deepSeekSecretName = "deepseek-api-key";

export interface DailyReportRouterDependencies {
  secretStore: SecretStore;
  deepSeekClient: DailyReportGenerator;
  allowLoopbackHttp?: boolean;
}

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

export function createDailyReportRouter(paths: AppPaths, dependencies: DailyReportRouterDependencies): Router {
  const router = Router();

  router.use((request, response, next) => {
    const database = openDatabase(paths);
    response.locals.dailyReportRepository = new DailyReportRepository(database);
    response.locals.settingsRepository = new SettingsRepository(database);
    response.locals.requestSignal = bindRequestLifecycle(request, response, () => database.close());
    next();
  });

  const reportsFor = (response: Response): DailyReportRepository => response.locals.dailyReportRepository as DailyReportRepository;
  const settingsFor = (response: Response): SettingsRepository => response.locals.settingsRepository as SettingsRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

  router.post("/daily-reports/generate", handle(async (request, response) => {
    const signal = response.locals.requestSignal as AbortSignal;
    const parsed = DailyReportInputSchema.safeParse(request.body);
    if (!parsed.success) return errorResponse(response, 400, "Daily report validation failed", "VALIDATION_ERROR");

    const apiKey = await dependencies.secretStore.readSecret(deepSeekSecretName);
    if (!requestCanContinue(request, response, signal)) return;
    const settings = settingsFor(response).getDeepSeekSettings(Boolean(apiKey));
    if (!apiKey || !settings.model.trim() || !isAllowedDeepSeekUrl(settings.baseUrl, Boolean(dependencies.allowLoopbackHttp))) {
      return errorResponse(response, 409, "请先在设置中配置 DeepSeek", "DEEPSEEK_NOT_CONFIGURED");
    }

    let generated: { content: string; model: string };
    try {
      generated = await dependencies.deepSeekClient.generateDailyReport({
        completed: parsed.data.completed,
        risks: parsed.data.risks,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey,
        signal
      });
    } catch (error) {
      if (requestCanContinue(request, response, signal)) providerError(response, error);
      return;
    }

    if (!requestCanContinue(request, response, signal)) return;
    let saved: DailyReport;
    try {
      saved = reportsFor(response).create(parsed.data, generated);
    } catch {
      throw new Error("Daily report persistence failed");
    }
    if (requestCanContinue(request, response, signal)) response.status(201).json(saved);
  }));

  router.get("/daily-reports", (_request, response) => {
    response.json(reportsFor(response).list());
  });

  router.get("/daily-reports/:id", (request, response) => {
    const id = parseId(request.params.id);
    if (id === null) return errorResponse(response, 400, "Daily report ID is invalid", "VALIDATION_ERROR");
    const report = reportsFor(response).get(id);
    if (!report) return errorResponse(response, 404, "Daily report not found", "NOT_FOUND");
    response.json(report);
  });

  router.put("/daily-reports/:id", (request, response) => {
    const id = parseId(request.params.id);
    const parsed = DailyReportUpdateSchema.safeParse(request.body);
    if (id === null || !parsed.success) return errorResponse(response, 400, "Daily report validation failed", "VALIDATION_ERROR");
    const report = reportsFor(response).updateContent(id, parsed.data.content);
    if (!report) return errorResponse(response, 404, "Daily report not found", "NOT_FOUND");
    response.json(report);
  });

  return router;
}

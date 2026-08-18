import { Router, type NextFunction, type Request, type Response } from "express";
import {
  ConnectionTestResultSchema,
  DeepSeekSettingsUpdateSchema,
  MailSettingsUpdateSchema,
  SettingsResponseSchema,
  type ConnectionTestResult,
  type ConnectionTestStatus,
  type DeepSeekSettings,
  type MailSettings
} from "@workbench/contracts";
import nodemailer from "nodemailer";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { SecretStore } from "../../platform/dpapi.js";
import { SettingsRepository } from "./settings.repository.js";

const DEEPSEEK_SECRET_NAME = "deepseek-api-key";
const SMTP_SECRET_NAME = "smtp-password";

export interface ProviderConnectionInput {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface MailConnectionInput {
  smtpHost: string;
  smtpPort: number;
  transportMode: "starttls" | "tls";
  smtpUsername: string;
  fromAddress: string;
  smtpPassword: string;
  timeoutMs: number;
}

export type DeepSeekConnectionTester = (input: ProviderConnectionInput) => Promise<void>;
export type MailConnectionTester = (input: MailConnectionInput) => Promise<void>;

export class ConnectionTestFailure extends Error {
  public constructor(public readonly category: Exclude<ConnectionTestStatus, "success">) {
    super("External connection test failed");
    this.name = "ConnectionTestFailure";
  }
}

export interface SettingsRouterDependencies {
  secretStore: SecretStore;
  allowLoopbackHttp?: boolean;
  deepSeekConnectionTester?: DeepSeekConnectionTester;
  mailConnectionTester?: MailConnectionTester;
  connectionTimeoutMs?: number;
}

const connectionMessages: Record<ConnectionTestStatus, string> = {
  success: "连接成功",
  auth_failure: "身份验证失败，请检查凭据",
  timeout: "连接超时，请稍后重试",
  unreachable_host: "无法连接到服务器"
};

function result(status: ConnectionTestStatus): ConnectionTestResult {
  return ConnectionTestResultSchema.parse({ status, message: connectionMessages[status] });
}

function validationError(response: Response): void {
  response.status(400).json({ error: { message: "Settings validation failed", code: "VALIDATION_ERROR" } });
}

function notConfigured(response: Response): void {
  response.status(400).json({ error: { message: "Required credentials are not configured", code: "NOT_CONFIGURED" } });
}

export function isAllowedDeepSeekUrl(value: string, allowLoopbackHttp: boolean): boolean {
  const scheme = value.startsWith("https://") ? "https://" : allowLoopbackHttp && value.startsWith("http://") ? "http://" : null;
  if (!scheme || value.includes("\\")) return false;

  try {
    const url = new URL(value);
    const remainder = value.slice(scheme.length);
    const authorityEnd = remainder.search(/[/?#]/);
    const authority = authorityEnd === -1 ? remainder : remainder.slice(0, authorityEnd);
    if (!authority || authority.includes("@") || authority !== url.host) return false;
    if (url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) return false;
    if (scheme === "https://" && url.protocol === "https:") return true;
    return scheme === "http://" && url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  } catch {
    return false;
  }
}

function categoryFor(error: unknown): Exclude<ConnectionTestStatus, "success"> {
  if (error instanceof ConnectionTestFailure) return error.category;
  const candidate = error as { name?: string; code?: string } | null;
  if (candidate?.name === "AbortError" || candidate?.code === "ETIMEDOUT") return "timeout";
  if (candidate?.code === "EAUTH" || candidate?.code === "EENVELOPE") return "auth_failure";
  return "unreachable_host";
}

export const testDeepSeekConnection: DeepSeekConnectionTester = async (input) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: input.model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: controller.signal,
      redirect: "manual"
    });
    if (response.status === 401 || response.status === 403) throw new ConnectionTestFailure("auth_failure");
    if (!response.ok) throw new ConnectionTestFailure("unreachable_host");
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") throw new ConnectionTestFailure("timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const testMailConnection: MailConnectionTester = async (input) => {
  const transport = nodemailer.createTransport({
    host: input.smtpHost,
    port: input.smtpPort,
    secure: input.transportMode === "tls",
    requireTLS: input.transportMode === "starttls",
    auth: input.smtpUsername ? { user: input.smtpUsername, pass: input.smtpPassword } : undefined,
    connectionTimeout: input.timeoutMs,
    greetingTimeout: input.timeoutMs,
    socketTimeout: input.timeoutMs,
    tls: { servername: input.smtpHost }
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
};

export function createSettingsRouter(paths: AppPaths, dependencies: SettingsRouterDependencies): Router {
  const router = Router();
  const timeoutMs = dependencies.connectionTimeoutMs ?? 8_000;
  const providerTester = dependencies.deepSeekConnectionTester ?? testDeepSeekConnection;
  const mailTester = dependencies.mailConnectionTester ?? testMailConnection;

  router.use((_request, response, next) => {
    const database = openDatabase(paths);
    response.locals.settingsRepository = new SettingsRepository(database);
    response.once("finish", () => database.close());
    next();
  });

  const repositoryFor = (response: Response): SettingsRepository => response.locals.settingsRepository as SettingsRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);

  router.get("/settings", handle(async (_request, response) => {
    const [apiKey, smtpPassword] = await Promise.all([
      dependencies.secretStore.readSecret(DEEPSEEK_SECRET_NAME),
      dependencies.secretStore.readSecret(SMTP_SECRET_NAME)
    ]);
    const repository = repositoryFor(response);
    response.json(SettingsResponseSchema.parse({
      deepseek: repository.getDeepSeekSettings(Boolean(apiKey)),
      mail: repository.getMailSettings(Boolean(smtpPassword))
    }));
  }));

  router.put("/settings/deepseek", handle(async (request, response) => {
    const parsed = DeepSeekSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response);
    if (request.body?.baseUrl !== parsed.data.baseUrl || !isAllowedDeepSeekUrl(parsed.data.baseUrl, Boolean(dependencies.allowLoopbackHttp))) return validationError(response);
    const replacement = parsed.data.apiKey?.trim();
    if (replacement) await dependencies.secretStore.protectSecret(DEEPSEEK_SECRET_NAME, replacement);
    const configured = Boolean(replacement || await dependencies.secretStore.readSecret(DEEPSEEK_SECRET_NAME));
    response.json(repositoryFor(response).saveDeepSeekSettings(parsed.data, configured));
  }));

  router.put("/settings/mail", handle(async (request, response) => {
    const parsed = MailSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response);
    const replacement = parsed.data.smtpPassword?.trim();
    if (replacement) await dependencies.secretStore.protectSecret(SMTP_SECRET_NAME, replacement);
    const configured = Boolean(replacement || await dependencies.secretStore.readSecret(SMTP_SECRET_NAME));
    response.json(repositoryFor(response).saveMailSettings(parsed.data, configured));
  }));

  router.post("/settings/deepseek/test", handle(async (_request, response) => {
    const apiKey = await dependencies.secretStore.readSecret(DEEPSEEK_SECRET_NAME);
    const settings: DeepSeekSettings = repositoryFor(response).getDeepSeekSettings(Boolean(apiKey));
    if (!apiKey || !isAllowedDeepSeekUrl(settings.baseUrl, Boolean(dependencies.allowLoopbackHttp))) return notConfigured(response);
    try {
      await providerTester({ baseUrl: settings.baseUrl, model: settings.model, apiKey, timeoutMs });
      response.json(result("success"));
    } catch (error) {
      response.json(result(categoryFor(error)));
    }
  }));

  router.post("/settings/mail/test", handle(async (_request, response) => {
    const smtpPassword = await dependencies.secretStore.readSecret(SMTP_SECRET_NAME);
    const settings: MailSettings = repositoryFor(response).getMailSettings(Boolean(smtpPassword));
    if (!smtpPassword || !MailSettingsUpdateSchema.safeParse(settings).success) return notConfigured(response);
    try {
      await mailTester({ ...settings, smtpPassword, timeoutMs });
      response.json(result("success"));
    } catch (error) {
      response.json(result(categoryFor(error)));
    }
  }));

  return router;
}

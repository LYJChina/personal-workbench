import {
  PasswordManagerEntryIdSchema,
  PasswordManagerEntryInputSchema,
  PasswordManagerEntrySummarySchema,
  PasswordManagerEntryDetailSchema,
  PasswordManagerStatusSchema,
  SurfaceLayoutItemSchema
} from "@workbench/contracts";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  PasswordManagerAlreadyConfiguredError,
  PasswordManagerEntryNotFoundError,
  PasswordManagerIntegrityError,
  PasswordManagerInvalidPasswordError,
  PasswordManagerLockedError,
  PasswordManagerNotConfiguredError,
  type PasswordManagerService,
  PasswordManagerVersionConflictError
} from "./password-manager.service.js";

const sessionCookieName = "lyj_password_manager_session";
const cooldownFailures = 5;
const cooldownMs = 30_000;

export interface PasswordManagerRouterDependencies {
  passwordManager: PasswordManagerService;
  monotonicNow?: () => number;
}

function apiError(response: Response, status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

function setNoStoreHeaders(response: Response): void {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Vary", "Cookie");
}

export function passwordManagerNoStore(request: Request, response: Response, next: NextFunction): void {
  if (/^\/api\/password-manager(?:\/|$)/i.test(request.path)) setNoStoreHeaders(response);
  next();
}

function readSessionToken(request: Request): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== "string") return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== sessionCookieName) continue;
    const token = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
  }
  return undefined;
}

function setSessionCookie(response: Response, token: string): void {
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${token}; Path=/api/password-manager; HttpOnly; SameSite=Strict`
  );
}

function clearSessionCookie(response: Response): void {
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=; Path=/api/password-manager; HttpOnly; SameSite=Strict; Max-Age=0`
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePasswordBody(value: unknown): string | null {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || typeof value.password !== "string") return null;
  return value.password.length >= 12 && value.password.length <= 1_024 ? value.password : null;
}

function parseVersion(value: string | undefined): number | null {
  const match = value ? /^"([1-9][0-9]*)"$/.exec(value) : null;
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function parseLayouts(value: unknown): Array<{ id: string; x: number; y: number; w: number; h: number }> | null {
  if (!isPlainObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.items) || value.items.length > 10_000) return null;
  const layouts: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!isPlainObject(item)) return null;
    const surfaceLayout = SurfaceLayoutItemSchema.safeParse(item);
    const normalized = surfaceLayout.success
      ? { id: surfaceLayout.data.itemId, x: surfaceLayout.data.x, y: surfaceLayout.data.y, w: surfaceLayout.data.w, h: surfaceLayout.data.h }
      : Object.keys(item).sort().join(",") === "h,id,w,x,y"
        ? item as { id: unknown; x: unknown; y: unknown; w: unknown; h: unknown }
        : null;
    if (!normalized || !PasswordManagerEntryIdSchema.safeParse(normalized.id).success
      || typeof normalized.id !== "string" || ids.has(normalized.id)) return null;
    if (!Number.isInteger(normalized.x) || (normalized.x as number) < 0
      || !Number.isInteger(normalized.y) || (normalized.y as number) < 0
      || !Number.isInteger(normalized.w) || (normalized.w as number) < 1 || (normalized.w as number) > 16
      || !Number.isInteger(normalized.h) || (normalized.h as number) < 1 || (normalized.h as number) > 100) return null;
    ids.add(normalized.id);
    layouts.push(normalized as { id: string; x: number; y: number; w: number; h: number });
  }
  return layouts;
}

function handleServiceError(response: Response, error: unknown): void {
  if (error instanceof PasswordManagerLockedError) {
    apiError(response, 423, "Password manager is locked", "PASSWORD_MANAGER_LOCKED");
  } else if (error instanceof PasswordManagerEntryNotFoundError) {
    apiError(response, 404, "Entry not found", "ENTRY_NOT_FOUND");
  } else if (error instanceof PasswordManagerVersionConflictError) {
    apiError(response, 409, "Entry was modified", "VERSION_CONFLICT");
  } else if (error instanceof PasswordManagerIntegrityError) {
    apiError(response, 500, "Password-manager data could not be verified", "PASSWORD_MANAGER_INTEGRITY_ERROR");
  } else {
    apiError(response, 500, "Password-manager operation failed", "PASSWORD_MANAGER_ERROR");
  }
}

export function createPasswordManagerRouter({
  passwordManager,
  monotonicNow = () => performance.now()
}: PasswordManagerRouterDependencies): Router {
  const router = Router();
  let consecutiveFailures = 0;
  let cooldownUntil = 0;
  let lifecycleTail: Promise<void> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  router.use((_request, response, next) => {
    setNoStoreHeaders(response);
    next();
  });

  router.get("/password-manager/status", (request, response) => {
    try {
      response.json(PasswordManagerStatusSchema.parse(passwordManager.status(readSessionToken(request))));
    } catch {
      apiError(response, 500, "Password-manager data could not be verified", "PASSWORD_MANAGER_INTEGRITY_ERROR");
    }
  });

  router.post("/password-manager/setup", async (request, response) => {
    const password = parsePasswordBody(request.body);
    if (!password) return apiError(response, 400, "Invalid request", "VALIDATION_ERROR");
    await serialize(async () => {
      try {
        const token = await passwordManager.setup(password);
        const status = passwordManager.status(token);
        setSessionCookie(response, token);
        response.status(201).json(PasswordManagerStatusSchema.parse(status));
      } catch (error) {
        if (error instanceof PasswordManagerAlreadyConfiguredError) {
          return apiError(response, 409, "Password manager is already configured", "PASSWORD_MANAGER_ALREADY_CONFIGURED");
        }
        handleServiceError(response, error);
      }
    });
  });

  router.post("/password-manager/unlock", async (request, response) => {
    const password = parsePasswordBody(request.body);
    if (!password) return apiError(response, 400, "Invalid request", "VALIDATION_ERROR");
    await serialize(async () => {
      const currentTime = monotonicNow();
      if (cooldownUntil > currentTime) {
        return apiError(response, 429, "Too many attempts; try again later", "TOO_MANY_ATTEMPTS");
      }
      if (cooldownUntil !== 0) {
        cooldownUntil = 0;
        consecutiveFailures = 0;
      }
      try {
        const token = await passwordManager.unlock(password);
        consecutiveFailures = 0;
        cooldownUntil = 0;
        const status = passwordManager.status(token);
        setSessionCookie(response, token);
        response.json(PasswordManagerStatusSchema.parse(status));
      } catch (error) {
        if (error instanceof PasswordManagerInvalidPasswordError) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= cooldownFailures) cooldownUntil = monotonicNow() + cooldownMs;
          return apiError(response, 401, "Password is incorrect", "INVALID_PASSWORD");
        }
        if (error instanceof PasswordManagerNotConfiguredError) {
          return apiError(response, 409, "Password manager is not configured", "PASSWORD_MANAGER_NOT_CONFIGURED");
        }
        handleServiceError(response, error);
      }
    });
  });

  router.post("/password-manager/lock", async (request, response) => {
    await serialize(async () => {
      passwordManager.lock(readSessionToken(request));
      clearSessionCookie(response);
      response.status(204).end();
    });
  });

  router.get("/password-manager/entries", (request, response) => {
    try {
      const entries = passwordManager.listEntries(readSessionToken(request));
      response.json({
        items: entries.map((entry) => PasswordManagerEntrySummarySchema.parse(entry.summary)),
        layouts: entries.map((entry) => ({ id: entry.summary.id, ...entry.layout })),
        versions: Object.fromEntries(entries.map((entry) => [entry.summary.id, entry.version]))
      });
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.post("/password-manager/entries", (request, response) => {
    const parsed = PasswordManagerEntryInputSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "Invalid request", "VALIDATION_ERROR");
    try {
      const created = passwordManager.createEntry(readSessionToken(request), parsed.data);
      response.setHeader("ETag", `"${created.version}"`);
      response.status(201).json(PasswordManagerEntrySummarySchema.parse(created.summary));
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.put("/password-manager/entries/:id", (request, response) => {
    const id = PasswordManagerEntryIdSchema.safeParse(request.params.id);
    const input = PasswordManagerEntryInputSchema.safeParse(request.body);
    const version = parseVersion(request.get("If-Match"));
    if (!id.success || !input.success) return apiError(response, 400, "Invalid request", "VALIDATION_ERROR");
    if (version === null) return apiError(response, 428, "Entry version is required", "VERSION_REQUIRED");
    try {
      const updated = passwordManager.updateEntry(readSessionToken(request), id.data, input.data, version);
      response.setHeader("ETag", `"${updated.version}"`);
      response.json(PasswordManagerEntrySummarySchema.parse(updated.summary));
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.delete("/password-manager/entries/:id", (request, response) => {
    const id = PasswordManagerEntryIdSchema.safeParse(request.params.id);
    if (!id.success) return apiError(response, 400, "Invalid request", "VALIDATION_ERROR");
    try {
      passwordManager.deleteEntry(readSessionToken(request), id.data);
      response.status(204).end();
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.post("/password-manager/entries/:id/reveal", (request, response) => {
    const id = PasswordManagerEntryIdSchema.safeParse(request.params.id);
    if (!id.success || (request.body !== undefined && (!isPlainObject(request.body) || Object.keys(request.body).length !== 0))) {
      return apiError(response, 400, "Invalid request", "VALIDATION_ERROR");
    }
    try {
      const revealed = passwordManager.revealEntry(readSessionToken(request), id.data);
      response.setHeader("ETag", `"${revealed.version}"`);
      response.json(PasswordManagerEntryDetailSchema.parse(revealed.detail));
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  router.put("/password-manager/layout", (request, response) => {
    const layouts = parseLayouts(request.body);
    if (!layouts) return apiError(response, 400, "Invalid request", "VALIDATION_ERROR");
    try {
      passwordManager.updateLayouts(readSessionToken(request), layouts);
      response.status(204).end();
    } catch (error) {
      handleServiceError(response, error);
    }
  });

  return router;
}

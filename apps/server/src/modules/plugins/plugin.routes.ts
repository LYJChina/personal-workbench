import { PluginIdSchema, type PluginSummary } from "@workbench/contracts";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { ContributionRegistry } from "../../kernel/contribution-registry.js";
import type { PluginLifecycle } from "../../kernel/plugin-lifecycle.js";
import {
  waitForPluginStartup,
  type PluginStartupReadiness
} from "../../kernel/plugin-route-guard.js";

interface PluginRouterDependencies {
  lifecycle: PluginLifecycle;
  registry: ContributionRegistry;
  readiness: PluginStartupReadiness;
}

const notFoundResponse = {
  error: { message: "Plugin not found", code: "PLUGIN_NOT_FOUND" }
} as const;
const requiredResponse = {
  error: { message: "Required plugin cannot be disabled", code: "PLUGIN_REQUIRED" }
} as const;
const validationResponse = {
  error: { message: "Plugin enablement validation failed", code: "VALIDATION_ERROR" }
} as const;

function isEnablementBody(body: unknown): body is { enabled: boolean } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === "enabled"
    && typeof (body as { enabled?: unknown }).enabled === "boolean";
}

function findSummary(lifecycle: PluginLifecycle, id: string): PluginSummary | undefined {
  if (!PluginIdSchema.safeParse(id).success) return undefined;
  return lifecycle.status().find((summary) => summary.manifest.id === id);
}

export function createPluginRouter(dependencies: PluginRouterDependencies): Router {
  const router = Router();

  router.use("/plugins", async (_request, response, next) => {
    if (await waitForPluginStartup(dependencies.readiness, response)) next();
  });

  router.get("/plugins", (_request, response) => {
    response.json(dependencies.lifecycle.status());
  });

  router.get("/plugins/contributions", (_request, response) => {
    const running = new Set(dependencies.lifecycle.status()
      .filter((summary) => summary.enabled && summary.runtimeStatus === "running")
      .map((summary) => summary.manifest.id));
    response.json(dependencies.registry.list().filter((entry) => running.has(entry.pluginId)));
  });

  router.put("/plugins/:id/enabled", async (request: Request, response: Response, next: NextFunction) => {
    const summary = findSummary(dependencies.lifecycle, String(request.params.id));
    if (!summary) {
      response.status(404).json(notFoundResponse);
      return;
    }
    if (!isEnablementBody(request.body)) {
      response.status(400).json(validationResponse);
      return;
    }
    if (!request.body.enabled && summary.required) {
      response.status(409).json(requiredResponse);
      return;
    }

    try {
      if (request.body.enabled) await dependencies.lifecycle.enable(summary.manifest.id);
      else await dependencies.lifecycle.disable(summary.manifest.id);
      response.json(findSummary(dependencies.lifecycle, summary.manifest.id));
    } catch {
      next(new Error("Plugin operation failed"));
    }
  });

  router.post("/plugins/safe-mode/reset", async (_request, response, next) => {
    try {
      dependencies.lifecycle.resetSafeMode();
      await dependencies.lifecycle.startAll();
      response.json(dependencies.lifecycle.status());
    } catch {
      next(new Error("Plugin safe mode reset failed"));
    }
  });

  return router;
}

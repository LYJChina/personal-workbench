import type { NextFunction, Request, Response } from "express";
import type { PluginLifecycle } from "./plugin-lifecycle.js";

export interface PluginStartupReadiness {
  wait(): Promise<boolean>;
}

const defaultPluginStartupTimeoutMs = 5_000;

export interface PluginRouteOwnership {
  path: string;
  descendants: boolean;
}

interface PluginRouteGuardDependencies {
  lifecycle: PluginLifecycle;
  pluginId: string;
  ownership: readonly PluginRouteOwnership[];
  readiness: PluginStartupReadiness;
}

const disabledResponse = {
  error: { message: "Plugin disabled", code: "PLUGIN_DISABLED" }
} as const;

const unavailableResponse = {
  error: { message: "Internal Server Error", code: "INTERNAL_ERROR" }
} as const;

function normalizePath(path: string): string {
  const caseInsensitivePath = path.toLowerCase();
  return caseInsensitivePath.length > 1 && caseInsensitivePath.endsWith("/")
    ? caseInsensitivePath.slice(0, -1)
    : caseInsensitivePath;
}

function ownsPath(requestPath: string, ownership: PluginRouteOwnership): boolean {
  const normalizedRequestPath = normalizePath(requestPath);
  const normalizedOwnedPath = normalizePath(ownership.path);
  if (normalizedRequestPath === normalizedOwnedPath) return true;
  return ownership.descendants && normalizedRequestPath.startsWith(`${normalizedOwnedPath}/`);
}

export function createPluginStartupReadiness(
  startup: Promise<void>,
  timeoutMs = defaultPluginStartupTimeoutMs
): PluginStartupReadiness {
  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : defaultPluginStartupTimeoutMs;
  const settlement = startup.then(
    () => true,
    () => false
  );

  return Object.freeze({
    wait: () => new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), boundedTimeoutMs);
      timer.unref?.();
      settlement.then((ready) => {
        clearTimeout(timer);
        resolve(ready);
      });
    })
  });
}

export async function waitForPluginStartup(
  readiness: PluginStartupReadiness,
  response: Response
): Promise<boolean> {
  try {
    if (await readiness.wait()) return true;
  } catch {
    // Initialization details stay inside core; callers receive one fixed error surface.
  }
  response.status(500).json(unavailableResponse);
  return false;
}

export function createPluginRouteGuard(dependencies: PluginRouteGuardDependencies) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (!dependencies.ownership.some((ownership) => ownsPath(request.path, ownership))) {
      next();
      return;
    }
    try {
      await dependencies.readiness.wait();
      const summary = dependencies.lifecycle.status().find((entry) => entry.manifest.id === dependencies.pluginId);
      if (!summary?.enabled || summary.runtimeStatus !== "running") {
        response.status(404).json(disabledResponse);
        return;
      }
      next();
    } catch {
      response.status(500).json(unavailableResponse);
    }
  };
}

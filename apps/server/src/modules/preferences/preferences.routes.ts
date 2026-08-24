import { Router, type Response } from "express";
import { AppearanceSettingsSchema, DashboardLayoutSchema, NavigationItemSchema, ThemePreferenceSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import { PreferencesRepository } from "./preferences.repository.js";
import { bindRequestLifecycle } from "../../http/request-lifecycle.js";

const layoutInputSchema = DashboardLayoutSchema.array().min(1).superRefine((items, context) => {
  if (new Set(items.map((item) => item.moduleId)).size !== items.length) {
    context.addIssue({ code: "custom", message: "Module IDs must be unique" });
  }
});

const seededNavigationIds = ["home", "ai-office", "reminders", "vault-coming-soon", "settings"] as const;

const navigationInputSchema = NavigationItemSchema.array().superRefine((items, context) => {
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Navigation IDs must be unique" });
  for (const id of seededNavigationIds) {
    if (!ids.includes(id)) context.addIssue({ code: "custom", message: `${id} must be preserved` });
  }
});

function validationError(response: Response): void {
  response.status(400).json({ error: { message: "Preferences validation failed", code: "VALIDATION_ERROR" } });
}

export function createPreferencesRouter(paths: AppPaths): Router {
  const router = Router();

  router.use((request, response, next) => {
    const database = openDatabase(paths);
    response.locals.preferencesRepository = new PreferencesRepository(database);
    bindRequestLifecycle(request, response, () => database.close());
    next();
  });

  const repositoryFor = (response: Response): PreferencesRepository => response.locals.preferencesRepository as PreferencesRepository;

  router.get("/preferences/layout", (_request, response) => response.json(repositoryFor(response).getLayout()));
  router.put("/preferences/layout", (request, response) => {
    const parsed = layoutInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response);
    return response.json(repositoryFor(response).saveLayout(parsed.data));
  });

  router.get("/preferences/navigation", (_request, response) => response.json(repositoryFor(response).getNavigation()));
  router.put("/preferences/navigation", (request, response) => {
    const parsed = navigationInputSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response);
    return response.json(repositoryFor(response).saveNavigation(parsed.data));
  });

  router.get("/preferences/theme", (_request, response) => response.json({ theme: repositoryFor(response).getTheme() }));
  router.put("/preferences/theme", (request, response) => {
    const parsed = ThemePreferenceSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response);
    return response.json({ theme: repositoryFor(response).saveTheme(parsed.data.theme) });
  });

  router.get("/preferences/appearance", (_request, response) => response.json({ appearance: repositoryFor(response).getAppearance() }));
  router.put("/preferences/appearance", (request, response) => {
    const parsed = AppearanceSettingsSchema.safeParse(request.body);
    if (!parsed.success) return validationError(response);
    return response.json(repositoryFor(response).saveAppearance(parsed.data));
  });

  return router;
}

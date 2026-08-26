import { Router } from "express";
import { AiPersonaSettingsUpdateSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openOperationalDatabase } from "../../db/database.js";
import { bindRequestLifecycle } from "../../http/request-lifecycle.js";
import { AiPersonaRepository } from "./ai-persona.repository.js";
export function createAiPersonaRouter(paths: AppPaths): Router {
  const router = Router();
  router.use((request, response, next) => { const db = openOperationalDatabase(paths); response.locals.aiPersona = new AiPersonaRepository(db); bindRequestLifecycle(request, response, () => db.close()); next(); });
  router.get("/ai-chat/persona", (_req, res) => res.json((res.locals.aiPersona as AiPersonaRepository).get()));
  router.put("/ai-chat/persona", (req, res) => { const parsed = AiPersonaSettingsUpdateSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { message: "AI 设置格式不正确", code: "VALIDATION_ERROR" } }); return res.json((res.locals.aiPersona as AiPersonaRepository).update(parsed.data)); });
  return router;
}

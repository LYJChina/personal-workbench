import { Router } from "express";
import { AiPersonaSettingsUpdateSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openOperationalDatabase } from "../../db/database.js";
import { bindRequestLifecycle } from "../../http/request-lifecycle.js";
import { AiPersonaRepository } from "./ai-persona.repository.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import type { AiGateway } from "../ai-gateway/ai-gateway.js";
import { sendAiGatewayError } from "../ai-gateway/ai-gateway.http.js";
export function createAiPersonaRouter(paths: AppPaths, dependencies: { gateway: Pick<AiGateway, "complete"> }): Router {
  const router = Router();
  router.use((request, response, next) => { const db = openOperationalDatabase(paths); response.locals.aiPersona = new AiPersonaRepository(db); response.locals.requestSignal = bindRequestLifecycle(request, response, () => db.close()); next(); });
  router.get("/ai-chat/persona", (_req, res) => res.json((res.locals.aiPersona as AiPersonaRepository).get()));
  router.put("/ai-chat/persona", (req, res) => { const parsed = AiPersonaSettingsUpdateSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: { message: "AI 设置格式不正确", code: "VALIDATION_ERROR" } }); return res.json((res.locals.aiPersona as AiPersonaRepository).update(parsed.data)); });
  router.post("/ai-chat/persona/generate", async (request, response) => {
    const database = openOperationalDatabase(paths);
    try {
      const profile = new ProfileRepository(database).get();
      const current = (response.locals.aiPersona as AiPersonaRepository).get();
      const profileText = JSON.stringify({ name: profile.name, birthday: profile.birthday, employeeNumber: profile.employeeNumber, customFields: profile.customFields });
      const generated = await dependencies.gateway.complete({
        messages: [{ role: "system", content: "根据用户资料生成一段准确、克制、适合长期注入个人办公助手的中文用户画像。只输出画像正文，不虚构资料。" }, { role: "user", content: profileText }],
        temperature: 0.3,
        maxTokens: 1_000,
        signal: response.locals.requestSignal as AbortSignal
      });
      return response.json((response.locals.aiPersona as AiPersonaRepository).update({ ...current, profilePortrait: generated.content }));
    } catch (error) {
      return sendAiGatewayError(response, error);
    } finally { database.close(); }
  });
  return router;
}

import { Router } from "express";
import { ModelDigestSettingsUpdateSchema, StartModelDigestRunSchema } from "@workbench/contracts";
import type { ModelDigestService } from "./model-digest.service.js";

function error(response: Parameters<Parameters<Router["get"]>[1]>[1], status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

export function createModelDigestRouter(service: ModelDigestService): Router {
  const router = Router();
  const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const page = (query: Record<string, unknown>): { limit: number; offset: number } | null => {
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    return Number.isInteger(limit) && limit >= 1 && limit <= 50 && Number.isInteger(offset) && offset >= 0
      ? { limit, offset } : null;
  };

  router.get("/model-digest", (_request, response, next) => {
    void service.getOverview().then((overview) => response.json(overview)).catch(next);
  });

  router.put("/model-digest/settings", (request, response, next) => {
    const parsed = ModelDigestSettingsUpdateSchema.safeParse(request.body);
    if (!parsed.success) return error(response, 400, "设置内容无效，请检查收件邮箱。", "VALIDATION_ERROR");
    void service.updateSettings(parsed.data)
      .then((settings) => response.json(settings))
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.message === "services_not_configured") {
          error(response, 409, "请先配置默认 AI 模型和 SMTP 发件邮箱。", "SERVICES_NOT_CONFIGURED");
          return;
        }
        if (reason instanceof Error && (reason.message === "invalid_recipients" || reason.message === "recipients_required")) {
          error(response, 400, "请选择个人信息中有效的收件邮箱。", "INVALID_RECIPIENTS");
          return;
        }
        next(reason);
      });
  });

  router.post("/model-digest/runs", (request, response, next) => {
    const parsed = StartModelDigestRunSchema.safeParse(request.body);
    if (!parsed.success) return error(response, 400, "立即总结设置无效，请检查收件邮箱。", "VALIDATION_ERROR");
    void service.startManualRun(parsed.data)
      .then((id) => {
        if (!id) return error(response, 409, "已有模型总结正在运行，请稍后查看结果。", "RUN_IN_PROGRESS");
        response.status(202).json({ runId: id });
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.message === "smtp_not_configured") {
          error(response, 409, "请先配置 SMTP 发件邮箱，或关闭本次邮件发送。", "SMTP_NOT_CONFIGURED");
          return;
        }
        if (reason instanceof Error && (reason.message === "invalid_recipients" || reason.message === "recipients_required")) {
          error(response, 400, "请选择个人信息中有效的收件邮箱。", "INVALID_RECIPIENTS");
          return;
        }
        next(reason);
      });
  });

  router.get("/model-digest/runs", (request, response, next) => {
    const params = page(request.query);
    if (!params) return error(response, 400, "分页参数无效。", "VALIDATION_ERROR");
    try { response.json(service.listRuns(params.limit, params.offset)); }
    catch (reason) { next(reason); }
  });

  router.get("/model-digest/trash", (request, response, next) => {
    const params = page(request.query);
    if (!params) return error(response, 400, "分页参数无效。", "VALIDATION_ERROR");
    try { response.json(service.listDeletedRuns(params.limit, params.offset)); }
    catch (reason) { next(reason); }
  });

  router.get("/model-digest/trash/:id", (request, response) => {
    const id = String(request.params.id);
    if (!validId(id)) return error(response, 400, "记录编号无效。", "VALIDATION_ERROR");
    const run = service.getDeletedRun(id);
    if (!run) return error(response, 404, "没有找到这条回收站记录。", "NOT_FOUND");
    response.json(run);
  });

  router.post("/model-digest/trash/:id/restore", (request, response, next) => {
    const id = String(request.params.id);
    if (!validId(id)) return error(response, 400, "记录编号无效。", "VALIDATION_ERROR");
    try {
      if (!service.restoreRun(id)) return error(response, 404, "没有找到这条回收站记录。", "NOT_FOUND");
      response.json(service.getRun(id));
    } catch (reason) { next(reason); }
  });

  router.delete("/model-digest/runs/:id", (request, response, next) => {
    const id = String(request.params.id);
    if (!validId(id)) return error(response, 400, "记录编号无效。", "VALIDATION_ERROR");
    try {
      if (!service.deleteRun(id)) return error(response, 404, "没有找到这条历史记录。", "NOT_FOUND");
      response.status(204).end();
    } catch (reason) {
      if (reason instanceof Error && reason.message === "run_active") {
        error(response, 409, "正在运行的任务不能移到回收站。", "RUN_ACTIVE");
        return;
      }
      next(reason);
    }
  });

  router.get("/model-digest/runs/:id", (request, response) => {
    const id = String(request.params.id);
    if (!validId(id)) return error(response, 400, "记录编号无效。", "VALIDATION_ERROR");
    const run = service.getRun(id);
    if (!run) return error(response, 404, "没有找到这次模型总结。", "NOT_FOUND");
    response.json(run);
  });

  return router;
}

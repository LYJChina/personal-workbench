import { Router, type NextFunction, type Request, type Response } from "express";
import { ReminderTestResultSchema, ReminderUpdateSchema, type ReminderTestResult } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { SecretStore } from "../../platform/dpapi.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { EmailNotificationChannel } from "./email-channel.js";
import type { NotificationChannel } from "./notification-channel.js";
import { ReminderRepository } from "./reminder.repository.js";

export interface ReminderRouterDependencies {
  secretStore: SecretStore;
  channel?: NotificationChannel;
  now?: () => Date;
}

function errorResponse(response: Response, status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

export function createReminderRouter(paths: AppPaths, dependencies: ReminderRouterDependencies): Router {
  const router = Router();
  const now = dependencies.now ?? (() => new Date());

  router.use((_request, response, next) => {
    const database = openDatabase(paths);
    response.locals.reminderRepository = new ReminderRepository(database);
    response.locals.reminderSettingsRepository = new SettingsRepository(database);
    response.once("finish", () => database.close());
    next();
  });

  const remindersFor = (response: Response): ReminderRepository => response.locals.reminderRepository as ReminderRepository;
  const settingsFor = (response: Response): SettingsRepository => response.locals.reminderSettingsRepository as SettingsRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
  const channelFor = (response: Response): NotificationChannel => dependencies.channel ?? new EmailNotificationChannel({
    secretStore: dependencies.secretStore,
    loadSettings: (configured) => settingsFor(response).getMailSettings(configured)
  });

  router.get("/reminders/outbound-checkin", (_request, response) => {
    response.json(remindersFor(response).get("outbound-checkin", now()));
  });

  router.put("/reminders/outbound-checkin", (request, response) => {
    const parsed = ReminderUpdateSchema.safeParse(request.body);
    if (!parsed.success || request.body?.recipient !== parsed.data.recipient || request.body?.subject !== parsed.data.subject || request.body?.body !== parsed.data.body) {
      return errorResponse(response, 400, "Reminder validation failed", "VALIDATION_ERROR");
    }
    response.json(remindersFor(response).save("outbound-checkin", parsed.data, now()));
  });

  router.post("/reminders/outbound-checkin/test", handle(async (_request, response) => {
    const reminder = remindersFor(response).get("outbound-checkin", now());
    let delivery;
    try {
      delivery = await channelFor(response).send({ to: reminder.recipient, subject: reminder.subject, body: reminder.body });
    } catch {
      delivery = { status: "failure" as const, category: "unknown" as const };
    }
    const result: ReminderTestResult = delivery.status === "success"
      ? { status: "success", message: "测试邮件已发送" }
      : { status: "failure", category: delivery.category, message: "测试邮件发送失败" };
    response.json(ReminderTestResultSchema.parse(result));
  }));

  return router;
}

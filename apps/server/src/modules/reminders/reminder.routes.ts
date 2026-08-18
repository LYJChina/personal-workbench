import { Router, type NextFunction, type Request, type Response } from "express";
import { GenericReminderInputSchema, ReminderTestResultSchema, ReminderUpdateSchema, type ReminderTestResult } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { SecretStore } from "../../platform/dpapi.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { EmailNotificationChannel } from "./email-channel.js";
import type { NotificationChannel } from "./notification-channel.js";
import { ReminderRepository } from "./reminder.repository.js";
import { GenericReminderRepository } from "./generic-reminder.repository.js";
import { HolidayRepository } from "../calendar/holiday.repository.js";
import { ReminderSchedulerService, type ReminderScheduler } from "./reminder-scheduler.js";

export interface ReminderRouterDependencies {
  secretStore: SecretStore;
  channel?: NotificationChannel;
  now?: () => Date;
  scheduler?: ReminderScheduler;
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
    response.locals.holidayRepository = new HolidayRepository(database);
    response.locals.genericReminderRepository = new GenericReminderRepository(
      database,
      response.locals.holidayRepository as HolidayRepository,
      now()
    );
    response.locals.reminderSettingsRepository = new SettingsRepository(database);
    response.once("finish", () => database.close());
    next();
  });

  const remindersFor = (response: Response): ReminderRepository => response.locals.reminderRepository as ReminderRepository;
  const settingsFor = (response: Response): SettingsRepository => response.locals.reminderSettingsRepository as SettingsRepository;
  const genericFor = (response: Response): GenericReminderRepository => response.locals.genericReminderRepository as GenericReminderRepository;
  const handle = (handler: (request: Request, response: Response) => Promise<void>) =>
    (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
  const channelFor = (response: Response): NotificationChannel => dependencies.channel ?? new EmailNotificationChannel({
    secretStore: dependencies.secretStore,
    loadSettings: (configured) => settingsFor(response).getMailSettings(configured)
  });
  const scheduler = dependencies.scheduler ?? ReminderSchedulerService.fromCurrentModule();
  const resynchronize = async (): Promise<void> => {
    if (!dependencies.scheduler) return;
    try {
      await dependencies.scheduler.sync();
    } catch {
      console.error("Reminder scheduler synchronization failed");
    }
  };

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

  router.get("/reminders", (_request, response) => {
    response.json({ items: genericFor(response).list(now()) });
  });
  router.get("/reminder-scheduler/status", handle(async (_request, response) => {
    response.json(await scheduler.status());
  }));

  router.post("/reminder-scheduler/sync", handle(async (_request, response) => {
    response.json(await scheduler.sync());
  }));

  router.post("/reminders", handle(async (request, response) => {
    const parsed = GenericReminderInputSchema.safeParse(request.body);
    if (!parsed.success) return errorResponse(response, 400, "Reminder validation failed", "VALIDATION_ERROR");
    const reminder = genericFor(response).create(parsed.data, now());
    await resynchronize();
    response.status(201).json(reminder);
  }));

  router.get("/reminder-attempts", (_request, response) => {
    response.json({ items: genericFor(response).listAttempts() });
  });

  router.get("/dashboard/upcoming-reminders", (_request, response) => {
    response.json({ items: genericFor(response).list(now()).filter((item) => item.enabled && item.nextRun !== null) });
  });

  router.get("/reminders/:id", (request, response) => {
    try {
      response.json(genericFor(response).get(String(request.params.id), now()));
    } catch {
      errorResponse(response, 404, "Reminder not found", "NOT_FOUND");
    }
  });

  router.put("/reminders/:id", handle(async (request, response) => {
    const parsed = GenericReminderInputSchema.safeParse(request.body);
    if (!parsed.success) return errorResponse(response, 400, "Reminder validation failed", "VALIDATION_ERROR");
    try {
      const reminder = genericFor(response).update(String(request.params.id), parsed.data, now());
      await resynchronize();
      response.json(reminder);
    } catch {
      errorResponse(response, 404, "Reminder not found", "NOT_FOUND");
    }
  }));

  router.delete("/reminders/:id", handle(async (request, response) => {
    try {
      genericFor(response).delete(String(request.params.id));
      await resynchronize();
      response.status(204).end();
    } catch {
      errorResponse(response, 404, "Reminder not found", "NOT_FOUND");
    }
  }));

  router.post("/reminders/:id/test", handle(async (request, response) => {
    let reminder;
    try {
      reminder = genericFor(response).get(String(request.params.id), now());
    } catch {
      errorResponse(response, 404, "Reminder not found", "NOT_FOUND");
      return;
    }
    let delivery;
    try {
      delivery = await channelFor(response).send({ to: reminder.recipient, subject: reminder.subject, body: reminder.body });
    } catch {
      delivery = { status: "failure" as const, category: "unknown" as const };
    }
    response.json(delivery.status === "success"
      ? { status: "success", message: "测试邮件已发送" }
      : { status: "failure", category: delivery.category, message: "测试邮件发送失败" });
  }));

  return router;
}

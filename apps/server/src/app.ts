import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { HealthResponseSchema } from "@workbench/contracts";
import { resolveAppPaths } from "./config/paths.js";
import { createProfileRouter, isPhotoUploadLimitError } from "./modules/profile/profile.routes.js";
import { createPreferencesRouter } from "./modules/preferences/preferences.routes.js";
import { createDailyReportRouter } from "./modules/daily-reports/daily-report.routes.js";
import { DeepSeekClient, type DailyReportGenerator } from "./modules/daily-reports/deepseek.client.js";
import { createSettingsRouter, type DeepSeekConnectionTester, type MailConnectionTester } from "./modules/settings/settings.routes.js";
import { WindowsDpapiSecretStore, type SecretStore } from "./platform/dpapi.js";
import { createReminderRouter } from "./modules/reminders/reminder.routes.js";
import type { NotificationChannel } from "./modules/reminders/notification-channel.js";
import { createAiPolishRouter } from "./modules/ai-polish/ai-polish.routes.js";
import { AiPolishClient, type AiPolishGenerator } from "./modules/ai-polish/ai-polish.client.js";
import { createHolidayRouter } from "./modules/calendar/holiday.routes.js";
import type { HolidayYearLoader } from "./modules/calendar/holiday.client.js";
import type { ReminderScheduler } from "./modules/reminders/reminder-scheduler.js";

export interface CreateAppOptions {
  dataDir?: string;
  secretStore?: SecretStore;
  allowLoopbackHttp?: boolean;
  deepSeekConnectionTester?: DeepSeekConnectionTester;
  mailConnectionTester?: MailConnectionTester;
  connectionTimeoutMs?: number;
  deepSeekClient?: DailyReportGenerator;
  aiPolishClient?: AiPolishGenerator;
  reminderChannel?: NotificationChannel;
  holidayYearLoader?: HolidayYearLoader;
  reminderScheduler?: ReminderScheduler;
  now?: () => Date;
  webDistDir?: string;
  instanceToken?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const paths = resolveAppPaths(options);
  const secretStore = options.secretStore ?? new WindowsDpapiSecretStore(paths.secretsDir);
  const deepSeekClient = options.deepSeekClient ?? new DeepSeekClient();
  const aiPolishClient = options.aiPolishClient ?? new AiPolishClient();

  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    if (options.instanceToken) {
      response.setHeader("X-LYJ-Workbench-Instance", options.instanceToken);
    }
    response.json(HealthResponseSchema.parse({ status: "ok" }));
  });

  app.use("/api", createProfileRouter(paths));
  app.use("/api", createPreferencesRouter(paths));
  app.use("/api", createDailyReportRouter(paths, {
    secretStore,
    deepSeekClient,
    allowLoopbackHttp: options.allowLoopbackHttp
  }));
  app.use("/api", createAiPolishRouter(paths, {
    secretStore,
    generator: aiPolishClient,
    allowLoopbackHttp: options.allowLoopbackHttp
  }));
  app.use("/api", createReminderRouter(paths, {
    secretStore,
    channel: options.reminderChannel,
    now: options.now
    ,scheduler: options.reminderScheduler
  }));
  app.use("/api", createHolidayRouter(paths, { loader: options.holidayYearLoader, now: options.now }));
  app.use("/api", createSettingsRouter(paths, {
    secretStore,
    allowLoopbackHttp: options.allowLoopbackHttp,
    deepSeekConnectionTester: options.deepSeekConnectionTester,
    mailConnectionTester: options.mailConnectionTester,
    connectionTimeoutMs: options.connectionTimeoutMs
  }));

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
  });

  if (options.webDistDir) {
    app.use(express.static(options.webDistDir));
    app.use((request, response, next) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        next();
        return;
      }
      response.sendFile("index.html", { root: options.webDistDir, dotfiles: "deny" }, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (isPhotoUploadLimitError(error)) {
      response.status(413).json({ error: { message: "Profile photo must be 5 MB or smaller", code: "PAYLOAD_TOO_LARGE" } });
      return;
    }
    console.error("Unhandled server error");
    response.status(500).json({ error: { message: "Internal Server Error", code: "INTERNAL_ERROR" } });
  });

  return app;
}

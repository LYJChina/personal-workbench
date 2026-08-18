import { pathToFileURL } from "node:url";
import { resolveAppPaths } from "./config/paths.js";
import { openDatabase } from "./db/database.js";
import { EmailNotificationChannel } from "./modules/reminders/email-channel.js";
import { ReminderRepository } from "./modules/reminders/reminder.repository.js";
import { runDueReminders } from "./modules/reminders/reminder.runner.js";
import { SettingsRepository } from "./modules/settings/settings.repository.js";
import { WindowsDpapiSecretStore } from "./platform/dpapi.js";
import { HolidayRepository } from "./modules/calendar/holiday.repository.js";
import { GenericReminderRepository } from "./modules/reminders/generic-reminder.repository.js";
import { runGenericReminders } from "./modules/reminders/generic-reminder.runner.js";

export function parseReminderArguments(arguments_: string[]): "outbound-checkin" {
  if (arguments_.length === 2 && arguments_[0] === "--reminder" && arguments_[1] === "outbound-checkin") return "outbound-checkin";
  throw new Error("Invalid reminder arguments");
}

export function applySchedulerSynchronizationArguments(
  arguments_: string[],
  repository: ReminderRepository,
  synchronizedAt: Date
): true {
  if (
    arguments_.length !== 4
    || arguments_[0] !== "--reminder"
    || arguments_[1] !== "outbound-checkin"
    || arguments_[2] !== "--scheduler-synchronized-time"
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(arguments_[3])
  ) throw new Error("Invalid scheduler synchronization arguments");
  repository.markSchedulerSynchronized("outbound-checkin", arguments_[3], synchronizedAt);
  return true;
}

export async function runReminderEntry(arguments_: string[]): Promise<number> {
  try {
    const runDue = arguments_.length === 1 && arguments_[0] === "--run-due";
    const schedulerSynchronization = arguments_.length === 4 && arguments_[2] === "--scheduler-synchronized-time";
    if (!schedulerSynchronization && !runDue) parseReminderArguments(arguments_);
    const paths = resolveAppPaths();
    const database = openDatabase(paths);
    try {
      const repository = new ReminderRepository(database);
      if (schedulerSynchronization) {
        applySchedulerSynchronizationArguments(arguments_, repository, new Date());
        console.log("Scheduler synchronization recorded");
        return 0;
      }
      const settingsRepository = new SettingsRepository(database);
      const channel = new EmailNotificationChannel({
        secretStore: new WindowsDpapiSecretStore(paths.secretsDir),
        loadSettings: (configured) => settingsRepository.getMailSettings(configured)
      });
      if (runDue) {
        const calendar = new HolidayRepository(database);
        const genericRepository = new GenericReminderRepository(database, calendar);
        const genericSummary = await runGenericReminders(new Date(), { repository: genericRepository, calendar, channel });
        if (genericSummary.failed > 0) return 1;
        console.log(genericSummary.sent > 0 ? "Reminder delivered" : "No reminder due");
        return 0;
      }
      const summary = await runDueReminders(new Date(), { repository, channel });
      if (summary.failed > 0) {
        console.error("Reminder delivery failed");
        return 1;
      }
      console.log(summary.sent > 0 ? "Reminder delivered" : "No reminder due");
      return 0;
    } finally {
      database.close();
    }
  } catch {
    console.error("Reminder runner failed");
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  process.exitCode = await runReminderEntry(process.argv.slice(2));
}

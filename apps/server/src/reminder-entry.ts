import { pathToFileURL } from "node:url";
import { resolveAppPaths } from "./config/paths.js";
import { openDatabase } from "./db/database.js";
import { EmailNotificationChannel } from "./modules/reminders/email-channel.js";
import { ReminderRepository } from "./modules/reminders/reminder.repository.js";
import { runDueReminders } from "./modules/reminders/reminder.runner.js";
import { SettingsRepository } from "./modules/settings/settings.repository.js";
import { WindowsDpapiSecretStore } from "./platform/dpapi.js";

export function parseReminderArguments(arguments_: string[]): "outbound-checkin" {
  if (arguments_.length === 2 && arguments_[0] === "--reminder" && arguments_[1] === "outbound-checkin") return "outbound-checkin";
  throw new Error("Invalid reminder arguments");
}

export async function runReminderEntry(arguments_: string[]): Promise<number> {
  try {
    parseReminderArguments(arguments_);
    const paths = resolveAppPaths();
    const database = openDatabase(paths);
    try {
      const repository = new ReminderRepository(database);
      const settingsRepository = new SettingsRepository(database);
      const channel = new EmailNotificationChannel({
        secretStore: new WindowsDpapiSecretStore(paths.secretsDir),
        loadSettings: (configured) => settingsRepository.getMailSettings(configured)
      });
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

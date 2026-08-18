import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { ReminderSchedulerService } from "./modules/reminders/reminder-scheduler.js";
import { resolveServerHost, resolveServerPort } from "./server-config.js";

const host = resolveServerHost(process.env.HOST);
const port = resolveServerPort(process.env.PORT);
const webDistDir = process.env.NODE_ENV === "production"
  ? fileURLToPath(new URL("../../web/dist/", import.meta.url))
  : undefined;
const instanceToken = process.env.LYJ_WORKBENCH_INSTANCE_TOKEN;

createApp({ webDistDir, instanceToken, reminderScheduler: ReminderSchedulerService.fromCurrentModule() }).listen(port, host, () => {
  console.log(`LYJ Workbench server listening on http://${host}:${port}`);
});

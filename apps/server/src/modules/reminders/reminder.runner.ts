import { randomUUID } from "node:crypto";
import type { ReminderFailureCategory } from "@workbench/contracts";
import type { NotificationChannel } from "./notification-channel.js";
import { chinaLocalDate, chinaParts, type ReminderRepository } from "./reminder.repository.js";

export interface ReminderRunSummary {
  checked: number;
  sent: number;
  failed: number;
}

export interface ReminderRunnerDependencies {
  repository: ReminderRepository;
  channel: NotificationChannel;
  claimToken?: () => string;
  claimLeaseMs?: number;
}

function isDue(now: Date, weekday: number, localTime: string): boolean {
  const parts = chinaParts(now);
  const [hour, minute] = localTime.split(":").map(Number);
  return parts.weekday === weekday && (parts.hour > hour || (parts.hour === hour && parts.minute >= minute));
}

export async function runDueReminders(now: Date, dependencies: ReminderRunnerDependencies): Promise<ReminderRunSummary> {
  const summary: ReminderRunSummary = { checked: 1, sent: 0, failed: 0 };
  const reminder = dependencies.repository.get("outbound-checkin", now);
  const localDate = chinaLocalDate(now);
  if (!reminder.enabled || !isDue(now, reminder.weekday, reminder.localTime) || dependencies.repository.wasDelivered(reminder.id, localDate)) {
    return summary;
  }

  const token = (dependencies.claimToken ?? randomUUID)();
  const leaseExpiresAt = new Date(now.getTime() + (dependencies.claimLeaseMs ?? 5 * 60_000));
  if (!dependencies.repository.acquireDeliveryClaim(reminder.id, localDate, token, now, leaseExpiresAt)) return summary;

  let result;
  try {
    result = await dependencies.channel.send({ to: reminder.recipient, subject: reminder.subject, body: reminder.body });
  } catch {
    result = { status: "failure" as const, category: "unknown" as ReminderFailureCategory };
  }
  if (result.status === "success") {
    if (dependencies.repository.completeDeliverySuccess(reminder.id, localDate, token, now)) summary.sent = 1;
    else summary.failed = 1;
  } else {
    dependencies.repository.completeDeliveryFailure(reminder.id, localDate, token, result.category, now);
    summary.failed = 1;
  }
  return summary;
}

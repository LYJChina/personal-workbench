import { randomUUID } from "node:crypto";
import type { NotificationChannel } from "./notification-channel.js";
import type { HolidayRepository } from "../calendar/holiday.repository.js";
import type { GenericReminderRepository } from "./generic-reminder.repository.js";
import { scheduledOccurrenceAtOrBefore } from "./reminder.schedule.js";

export interface GenericReminderSummary { checked: number; sent: number; failed: number; calendarBlocked: number; }

export async function runGenericReminders(now: Date, dependencies: {
  repository: GenericReminderRepository;
  calendar: HolidayRepository;
  channel: NotificationChannel;
  token?: () => string;
}): Promise<GenericReminderSummary> {
  const summary: GenericReminderSummary = { checked: 0, sent: 0, failed: 0, calendarBlocked: 0 };
  for (const reminder of dependencies.repository.list(now)) {
    summary.checked += 1;
    if (!reminder.enabled) continue;
    const occurrence = scheduledOccurrenceAtOrBefore(reminder, now, dependencies.calendar);
    if (!occurrence) {
      if (reminder.calendarBlocked) summary.calendarBlocked += 1;
      continue;
    }
    const scheduledFor = occurrence.toISOString();
    if (dependencies.repository.wasDelivered(reminder.id, scheduledFor)) continue;
    const token = (dependencies.token ?? randomUUID)();
    if (!dependencies.repository.acquireClaim(
      reminder.id, scheduledFor, token, now, new Date(now.getTime() + 5 * 60_000)
    )) continue;
    let result;
    try {
      result = await dependencies.channel.send({ to: reminder.recipient, subject: reminder.subject, body: reminder.body });
    } catch {
      result = { status: "failure" as const, category: "unknown" as const };
    }
    if (result.status === "success") {
      if (dependencies.repository.completeSuccess(reminder, scheduledFor, token, now)) summary.sent += 1;
    } else {
      if (dependencies.repository.completeFailure(reminder, scheduledFor, token, result.category, now)) summary.failed += 1;
    }
  }
  return summary;
}

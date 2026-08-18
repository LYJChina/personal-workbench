import type { HolidayRepository } from "../calendar/holiday.repository.js";
import type { GenericReminderRepository } from "./generic-reminder.repository.js";
import { scheduledOccurrenceAtOrBefore } from "./reminder.schedule.js";

const immediateDelayMs = 5_000;
const retryDelayMs = 5 * 60_000;

export function nextReminderWake(
  now: Date,
  repository: GenericReminderRepository,
  calendar: HolidayRepository
): Date | null {
  let earliest: Date | null = null;
  for (const reminder of repository.list(now)) {
    if (!reminder.enabled) continue;
    const due = scheduledOccurrenceAtOrBefore(reminder, now, calendar);
    let candidate: Date | null = reminder.nextRun ? new Date(reminder.nextRun) : null;
    if (due && !repository.wasDelivered(reminder.id, due.toISOString())) {
      const attempt = repository.attemptFor(reminder.id, due.toISOString());
      const earliestRetry = attempt?.status === "failure"
        ? attempt.attemptedAt.getTime() + retryDelayMs
        : now.getTime() + immediateDelayMs;
      candidate = new Date(Math.max(now.getTime() + immediateDelayMs, earliestRetry));
    }
    if (candidate && (!earliest || candidate.getTime() < earliest.getTime())) earliest = candidate;
  }
  return earliest;
}

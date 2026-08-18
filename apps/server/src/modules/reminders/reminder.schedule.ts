import type { GenericReminderInput } from "@workbench/contracts";

export interface WorkdayCalendar {
  isWorkday(localDate: string): boolean | null;
}

export type SchedulableReminder = GenericReminderInput & { successfulOccurrences: number };

const chinaFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
});

export function chinaLocalDate(value: Date): string {
  const parts = Object.fromEntries(chinaFormatter.formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function weekday(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function chinaDateTime(localDate: string, localTime: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

function matches(reminder: SchedulableReminder, localDate: string, calendar: WorkdayCalendar): boolean | null {
  if (localDate < reminder.startDate) return false;
  switch (reminder.scheduleType) {
    case "once": return localDate === reminder.startDate;
    case "daily": return true;
    case "workday": return calendar.isWorkday(localDate);
    case "weekly": return reminder.weekdays.includes(weekday(localDate));
    case "monthly": return Number(localDate.slice(8, 10)) === reminder.monthDay;
  }
}

export function nextOccurrence(
  reminder: SchedulableReminder,
  after: Date,
  calendar: WorkdayCalendar
): Date | null {
  if (!reminder.enabled) return null;
  if (reminder.lifecycle === "once" && reminder.successfulOccurrences > 0) return null;
  if (reminder.lifecycle === "finite" && reminder.totalOccurrences !== null
      && reminder.successfulOccurrences >= reminder.totalOccurrences) return null;
  let candidateDate = chinaLocalDate(after);
  if (candidateDate < reminder.startDate) candidateDate = reminder.startDate;
  for (let index = 0; index < 3700; index += 1) {
    const match = matches(reminder, candidateDate, calendar);
    if (match === null) return null;
    const candidate = chinaDateTime(candidateDate, reminder.localTime);
    if (match && candidate.getTime() > after.getTime()) return candidate;
    if (reminder.scheduleType === "once" && candidateDate >= reminder.startDate) return null;
    candidateDate = addDays(candidateDate, 1);
  }
  return null;
}

export function scheduledOccurrenceAtOrBefore(
  reminder: SchedulableReminder,
  now: Date,
  calendar: WorkdayCalendar
): Date | null {
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 - 1);
  let current = nextOccurrence(reminder, start, calendar);
  let latest: Date | null = null;
  while (current && current.getTime() <= now.getTime()) {
    latest = current;
    current = nextOccurrence(reminder, current, calendar);
  }
  return latest;
}

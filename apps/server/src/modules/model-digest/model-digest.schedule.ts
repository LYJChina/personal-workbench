const timeZone = "Asia/Shanghai";
const weekdays = new Set([1, 2, 3, 4, 5]);

interface LocalParts { year: number; month: number; day: number; weekday: number; hour: number; minute: number; }
const weekdayNumbers: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function modelDigestLocalParts(now: Date): LocalParts {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    weekday: weekdayNumbers[values.weekday], hour: Number(values.hour), minute: Number(values.minute)
  };
}

export function modelDigestLocalDate(now: Date): string {
  const parts = modelDigestLocalParts(now);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

export function isModelDigestDue(now: Date): boolean {
  const { weekday, hour, minute } = modelDigestLocalParts(now);
  return weekdays.has(weekday) && (hour > 9 || (hour === 9 && minute >= 0));
}

export function nextModelDigestRunAt(now: Date): string {
  const parts = modelDigestLocalParts(now);
  const base = Date.UTC(parts.year, parts.month - 1, parts.day);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(base + offset * 86_400_000);
    const weekday = date.getUTCDay();
    if (!weekdays.has(weekday)) continue;
    const candidate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 1);
    if (candidate > now.getTime()) return new Date(candidate).toISOString();
  }
  throw new Error("Could not calculate next model digest run");
}

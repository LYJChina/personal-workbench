import { HolidayDaySchema, type HolidayDay } from "@workbench/contracts";

interface HolidayGroup { name: string; range: [string, string?]; type: "holiday" | "workingday"; }

function parseGroups(value: unknown): HolidayGroup[] {
  if (!Array.isArray(value)) throw new Error("Invalid holiday source payload");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid holiday source group");
    const group = item as Record<string, unknown>;
    if (typeof group.name !== "string" || !group.name.trim() || group.name.length > 100
        || !Array.isArray(group.range) || group.range.length < 1 || group.range.length > 2
        || group.range.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        || (group.type !== "holiday" && group.type !== "workingday")) {
      throw new Error("Invalid holiday source group");
    }
    return { name: group.name, range: group.range as [string, string?], type: group.type };
  });
}

export type HolidayYearLoader = (year: number, signal?: AbortSignal) => Promise<HolidayDay[] | null>;

function addDays(localDate: string, count: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export class GithubHolidayClient {
  public constructor(private readonly fetchImpl: typeof fetch = fetch, private readonly timeoutMs = 15_000) {}

  public async fetchYear(year: number, externalSignal?: AbortSignal): Promise<HolidayDay[] | null> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (externalSignal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `https://raw.githubusercontent.com/bastengao/chinese-holidays-data/master/data/${year}.json`,
        { signal: controller.signal, redirect: "error" }
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Holiday source unavailable");
      const groups = parseGroups(await response.json());
      const days: HolidayDay[] = [];
      for (const group of groups) {
        const [start, end = start] = group.range;
        let date = start;
        while (date <= end) {
          if (!date.startsWith(`${year}-`)) throw new Error("Holiday source returned another year");
          days.push(HolidayDaySchema.parse({
            localDate: date,
            dayType: group.type === "holiday" ? "holiday" : "makeup_workday",
            name: group.name
          }));
          date = addDays(date, 1);
        }
      }
      return days;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abort);
    }
  }
}

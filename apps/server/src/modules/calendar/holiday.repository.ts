import type Database from "better-sqlite3";
import type { HolidayDay } from "@workbench/contracts";

interface HolidayRow { day_type: HolidayDay["dayType"]; }

function yearOf(localDate: string): number {
  return Number(localDate.slice(0, 4));
}

function weekdayOf(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export class HolidayRepository {
  public constructor(private readonly database: Database.Database) {}

  public replaceYear(year: number, days: HolidayDay[], source: string, synchronizedAt: Date): void {
    if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("Invalid holiday year");
    if (days.some((day) => yearOf(day.localDate) !== year)) throw new Error("Holiday date outside requested year");
    const replace = this.database.transaction(() => {
      this.database.prepare("DELETE FROM holiday_calendar_days WHERE source_year = ?").run(year);
      const insert = this.database.prepare(`
        INSERT INTO holiday_calendar_days (local_date, day_type, name, source_year, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const day of days) insert.run(day.localDate, day.dayType, day.name, year, synchronizedAt.toISOString());
      this.database.prepare(`
        INSERT INTO holiday_calendar_syncs (year, source, status, synchronized_at)
        VALUES (?, ?, 'success', ?)
        ON CONFLICT(year) DO UPDATE SET source = excluded.source, status = 'success', synchronized_at = excluded.synchronized_at
      `).run(year, source, synchronizedAt.toISOString());
    });
    replace.immediate();
  }

  public isKnownYear(year: number): boolean {
    return Boolean(this.database.prepare(
      "SELECT 1 FROM holiday_calendar_syncs WHERE year = ? AND status = 'success'"
    ).get(year));
  }

  public isWorkday(localDate: string): boolean | null {
    if (!this.isKnownYear(yearOf(localDate))) return null;
    const override = this.database.prepare(
      "SELECT day_type FROM holiday_calendar_days WHERE local_date = ?"
    ).get(localDate) as HolidayRow | undefined;
    if (override) return override.day_type === "makeup_workday";
    const weekday = weekdayOf(localDate);
    return weekday >= 1 && weekday <= 5;
  }

  public list(from: string, to: string): HolidayDay[] {
    return (this.database.prepare(`
      SELECT local_date, day_type, name FROM holiday_calendar_days
      WHERE local_date BETWEEN ? AND ? ORDER BY local_date
    `).all(from, to) as Array<{ local_date: string; day_type: HolidayDay["dayType"]; name: string }>).map((row) => ({
      localDate: row.local_date,
      dayType: row.day_type,
      name: row.name
    }));
  }

  public coverage(): Array<{ year: number; synchronizedAt: string }> {
    return (this.database.prepare(`
      SELECT year, synchronized_at FROM holiday_calendar_syncs
      WHERE status = 'success' ORDER BY year
    `).all() as Array<{ year: number; synchronized_at: string }>).map((row) => ({
      year: row.year,
      synchronizedAt: row.synchronized_at
    }));
  }
}

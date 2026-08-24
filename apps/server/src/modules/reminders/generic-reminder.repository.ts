import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  GenericReminderAttemptSchema,
  GenericReminderSchema,
  type GenericReminder,
  type GenericReminderAttempt,
  type GenericReminderInput,
  type ReminderFailureCategory
} from "@workbench/contracts";
import type { HolidayRepository } from "../calendar/holiday.repository.js";
import { chinaLocalDate, nextOccurrence } from "./reminder.schedule.js";

interface ReminderRow {
  id: string; name: string; enabled: number; lifecycle: GenericReminderInput["lifecycle"];
  schedule_type: GenericReminderInput["scheduleType"]; start_date: string; local_time: string;
  weekdays_json: string; month_day: number | null; total_occurrences: number | null;
  successful_occurrences: number; recipient: string; subject: string; body: string;
}

interface AttemptRow {
  id: number; reminder_id: string | null; reminder_name: string; scheduled_for: string;
  attempted_at: string; status: "success" | "failure" | "skipped";
  error_category: ReminderFailureCategory | null; recipient: string; subject: string; body: string;
}

export class GenericReminderRepository {
  public constructor(
    private readonly database: Database.Database,
    private readonly calendar: HolidayRepository,
    now: Date = new Date()
  ) {
    const seeded = this.database.prepare("SELECT 1 FROM app_settings WHERE key = 'generic-reminders-seeded'").get();
    if (seeded) return;
    const legacy = this.database.prepare(`
      SELECT enabled, local_time, recipient, subject, body FROM reminders WHERE id = 'outbound-checkin'
    `).get() as { enabled: number; local_time: string; recipient: string; subject: string; body: string } | undefined;
    this.database.prepare(`
      INSERT OR IGNORE INTO generic_reminders
        (id, name, enabled, lifecycle, schedule_type, start_date, local_time, weekdays_json,
         month_day, total_occurrences, recipient, subject, body)
      VALUES ('outbound-checkin', '外勤打卡', ?, 'recurring', 'weekly', ?, ?, '[1]', NULL, NULL, ?, ?, ?)
    `).run(
      legacy?.enabled ?? 0,
      chinaLocalDate(now),
      legacy?.local_time ?? "09:00",
      legacy?.recipient ?? "",
      legacy?.subject ?? "提交外勤打卡提醒",
      legacy?.body ?? "请提交本周外勤打卡。"
    );
    this.database.prepare(`INSERT OR REPLACE INTO app_settings (key, value, updated_at)
      VALUES ('generic-reminders-seeded', '1', ?)`).run(now.toISOString());
  }

  private row(id: string): ReminderRow {
    const row = this.database.prepare("SELECT * FROM generic_reminders WHERE id = ?").get(id) as ReminderRow | undefined;
    if (!row) throw new Error("Reminder not found");
    return row;
  }

  private map(row: ReminderRow, now: Date): GenericReminder {
    const fields = {
      id: row.id, name: row.name, enabled: Boolean(row.enabled), lifecycle: row.lifecycle,
      scheduleType: row.schedule_type, startDate: row.start_date, localTime: row.local_time,
      weekdays: JSON.parse(row.weekdays_json) as number[], monthDay: row.month_day,
      totalOccurrences: row.total_occurrences, successfulOccurrences: row.successful_occurrences,
      recipient: row.recipient, subject: row.subject, body: row.body
    };
    const next = nextOccurrence(fields, now, this.calendar);
    return GenericReminderSchema.parse({
      ...fields,
      nextRun: next?.toISOString() ?? null,
      calendarBlocked: fields.enabled && fields.scheduleType === "workday" && next === null
    });
  }

  public list(now: Date = new Date()): GenericReminder[] {
    return (this.database.prepare("SELECT * FROM generic_reminders ORDER BY created_at, id").all() as ReminderRow[])
      .map((row) => this.map(row, now))
      .sort((left, right) => (left.nextRun ?? "9999").localeCompare(right.nextRun ?? "9999"));
  }

  public get(id: string, now: Date = new Date()): GenericReminder {
    return this.map(this.row(id), now);
  }

  public create(input: GenericReminderInput, now: Date = new Date()): GenericReminder {
    const id = randomUUID();
    this.write(id, input, now, true);
    return this.get(id, now);
  }

  public update(id: string, input: GenericReminderInput, now: Date = new Date()): GenericReminder {
    this.row(id);
    this.write(id, input, now, false);
    return this.get(id, now);
  }

  private write(id: string, input: GenericReminderInput, now: Date, insert: boolean): void {
    if (insert) {
      this.database.prepare(`
        INSERT INTO generic_reminders
          (id, name, enabled, lifecycle, schedule_type, start_date, local_time, weekdays_json,
           month_day, total_occurrences, recipient, subject, body, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, Number(input.enabled), input.lifecycle, input.scheduleType, input.startDate,
        input.localTime, JSON.stringify(input.weekdays), input.monthDay, input.totalOccurrences,
        input.recipient, input.subject, input.body, now.toISOString());
      return;
    }
    this.database.prepare(`
      UPDATE generic_reminders SET name = ?, enabled = ?, lifecycle = ?, schedule_type = ?, start_date = ?,
        local_time = ?, weekdays_json = ?, month_day = ?, total_occurrences = ?, recipient = ?, subject = ?,
        body = ?, updated_at = ? WHERE id = ?
    `).run(input.name, Number(input.enabled), input.lifecycle, input.scheduleType, input.startDate,
      input.localTime, JSON.stringify(input.weekdays), input.monthDay, input.totalOccurrences,
      input.recipient, input.subject, input.body, now.toISOString(), id);
  }

  public delete(id: string): void {
    const result = this.database.prepare("DELETE FROM generic_reminders WHERE id = ?").run(id);
    if (result.changes !== 1) throw new Error("Reminder not found");
  }

  public listAttempts(): GenericReminderAttempt[] {
    return (this.database.prepare("SELECT * FROM generic_reminder_attempts ORDER BY attempted_at DESC, id DESC").all() as AttemptRow[])
      .map((row) => GenericReminderAttemptSchema.parse({
        id: row.id, reminderId: row.reminder_id, reminderName: row.reminder_name,
        scheduledFor: row.scheduled_for, attemptedAt: row.attempted_at, status: row.status,
        errorCategory: row.error_category, recipient: row.recipient, subject: row.subject, body: row.body
      }));
  }

  public recordManualAttempt(
    reminder: GenericReminder,
    attemptedAt: Date,
    outcome: { status: "success" } | { status: "failure"; category: ReminderFailureCategory }
  ): void {
    const timestamp = attemptedAt.toISOString();
    this.database.prepare(`
      INSERT INTO generic_reminder_attempts
        (reminder_id, reminder_name, scheduled_for, attempted_at, status, error_category, recipient, subject, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reminder.id, reminder.name, timestamp, timestamp, outcome.status,
      outcome.status === "failure" ? outcome.category : null,
      reminder.recipient, reminder.subject, reminder.body);
  }
}

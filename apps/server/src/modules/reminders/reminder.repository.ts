import type Database from "better-sqlite3";
import { ReminderSchema, type Reminder, type ReminderFailureCategory, type ReminderId, type ReminderUpdate } from "@workbench/contracts";

const outboundCheckinId: ReminderId = "outbound-checkin";

interface ReminderRow {
  id: ReminderId;
  enabled: number;
  weekday: number;
  local_time: string;
  recipient: string;
  subject: string;
  body: string;
}

interface AttemptRow {
  local_date: string;
  attempted_at: string;
  error_category: ReminderFailureCategory | null;
}

interface ChinaParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

const weekdayNumbers: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function chinaParts(now: Date): ChinaParts {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: weekdayNumbers[values.weekday],
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

export function chinaLocalDate(now: Date): string {
  const parts = chinaParts(now);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function nextRun(now: Date, weekday: number, localTime: string): string {
  const parts = chinaParts(now);
  const [hour, minute] = localTime.split(":").map(Number);
  let daysAhead = (weekday - parts.weekday + 7) % 7;
  if (daysAhead === 0 && (parts.hour > hour || (parts.hour === hour && parts.minute > minute))) daysAhead = 7;
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + daysAhead, hour - 8, minute);
  return new Date(utc).toISOString();
}

function mapAttempt(row: AttemptRow | undefined, includeCategory: boolean) {
  if (!row) return null;
  return {
    localDate: row.local_date,
    attemptedAt: row.attempted_at,
    ...(includeCategory && row.error_category ? { category: row.error_category } : {})
  };
}

export class ReminderRepository {
  public constructor(private readonly database: Database.Database) {
    this.database.prepare(`
      INSERT OR IGNORE INTO reminders (id, enabled, weekday, local_time, recipient, subject, body)
      VALUES (?, 0, 1, '09:00', '', '提交外勤打卡提醒', '请提交本周外勤打卡。')
    `).run(outboundCheckinId);
  }

  public get(id: ReminderId, now: Date = new Date()): Reminder {
    const row = this.database.prepare(`
      SELECT id, enabled, weekday, local_time, recipient, subject, body
      FROM reminders WHERE id = ?
    `).get(id) as ReminderRow | undefined;
    if (!row) throw new Error("Reminder not found");
    const lastSuccess = this.latestAttempt(id, "success");
    const lastFailure = this.latestAttempt(id, "failure");
    return ReminderSchema.parse({
      id: row.id,
      enabled: Boolean(row.enabled),
      weekday: row.weekday,
      localTime: row.local_time,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      nextRun: row.enabled ? nextRun(now, row.weekday, row.local_time) : null,
      lastSuccess: mapAttempt(lastSuccess, false),
      lastFailure: mapAttempt(lastFailure, true)
    });
  }

  public save(id: ReminderId, input: ReminderUpdate, now: Date = new Date()): Reminder {
    this.database.prepare(`
      UPDATE reminders
      SET enabled = ?, local_time = ?, recipient = ?, subject = ?, body = ?, updated_at = ?
      WHERE id = ?
    `).run(Number(input.enabled), input.localTime, input.recipient, input.subject, input.body, now.toISOString(), id);
    return this.get(id, now);
  }

  public wasDelivered(id: ReminderId, localDate: string): boolean {
    const row = this.database.prepare(`
      SELECT 1 FROM reminder_delivery_attempts
      WHERE reminder_id = ? AND local_date = ? AND status = 'success'
    `).get(id, localDate);
    return Boolean(row);
  }

  public acquireDeliveryClaim(
    id: ReminderId,
    localDate: string,
    token: string,
    claimedAt: Date,
    expiresAt: Date
  ): boolean {
    const acquire = this.database.transaction(() => {
      if (this.wasDelivered(id, localDate)) return false;
      const result = this.database.prepare(`
        INSERT INTO reminder_delivery_claims (reminder_id, local_date, claim_token, claimed_at, claim_expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(reminder_id, local_date) DO UPDATE SET
          claim_token = excluded.claim_token,
          claimed_at = excluded.claimed_at,
          claim_expires_at = excluded.claim_expires_at
        WHERE reminder_delivery_claims.claim_expires_at <= excluded.claimed_at
      `).run(id, localDate, token, claimedAt.toISOString(), expiresAt.toISOString());
      return result.changes === 1;
    });
    return acquire.immediate();
  }

  public renewClaim(
    id: ReminderId,
    localDate: string,
    token: string,
    renewedAt: Date,
    expiresAt: Date
  ): boolean {
    const result = this.database.prepare(`
      UPDATE reminder_delivery_claims
      SET claimed_at = ?, claim_expires_at = ?
      WHERE reminder_id = ? AND local_date = ? AND claim_token = ?
    `).run(renewedAt.toISOString(), expiresAt.toISOString(), id, localDate, token);
    return result.changes === 1;
  }

  public completeDeliverySuccess(id: ReminderId, localDate: string, token: string, attemptedAt: Date): boolean {
    const complete = this.database.transaction(() => {
      const released = this.database.prepare(`
        DELETE FROM reminder_delivery_claims
        WHERE reminder_id = ? AND local_date = ? AND claim_token = ?
      `).run(id, localDate, token);
      if (released.changes !== 1) return false;
      this.database.prepare(`
        INSERT INTO reminder_delivery_attempts (reminder_id, local_date, status, error_category, attempted_at)
        VALUES (?, ?, 'success', NULL, ?)
        ON CONFLICT(reminder_id, local_date) DO UPDATE SET
          status = 'success', error_category = NULL, attempted_at = excluded.attempted_at
      `).run(id, localDate, attemptedAt.toISOString());
      this.database.prepare(`
        UPDATE reminders SET last_delivered_on = ?, last_failure_category = NULL, updated_at = ? WHERE id = ?
      `).run(localDate, attemptedAt.toISOString(), id);
      return true;
    });
    return complete.immediate();
  }

  public completeDeliveryFailure(
    id: ReminderId,
    localDate: string,
    token: string,
    category: ReminderFailureCategory,
    attemptedAt: Date
  ): boolean {
    const complete = this.database.transaction(() => {
      const released = this.database.prepare(`
        DELETE FROM reminder_delivery_claims
        WHERE reminder_id = ? AND local_date = ? AND claim_token = ?
      `).run(id, localDate, token);
      if (released.changes !== 1) return false;
      this.database.prepare(`
        INSERT INTO reminder_delivery_attempts (reminder_id, local_date, status, error_category, attempted_at)
        VALUES (?, ?, 'failure', ?, ?)
        ON CONFLICT(reminder_id, local_date) DO UPDATE SET
          status = 'failure', error_category = excluded.error_category, attempted_at = excluded.attempted_at
        WHERE reminder_delivery_attempts.status <> 'success'
      `).run(id, localDate, category, attemptedAt.toISOString());
      this.database.prepare(`
        UPDATE reminders SET last_failure_category = ?, updated_at = ? WHERE id = ?
      `).run(category, attemptedAt.toISOString(), id);
      return true;
    });
    return complete.immediate();
  }

  private latestAttempt(id: ReminderId, status: "success" | "failure"): AttemptRow | undefined {
    return this.database.prepare(`
      SELECT local_date, attempted_at, error_category
      FROM reminder_delivery_attempts
      WHERE reminder_id = ? AND status = ?
      ORDER BY attempted_at DESC, id DESC LIMIT 1
    `).get(id, status) as AttemptRow | undefined;
  }
}

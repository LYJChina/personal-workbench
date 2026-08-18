import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { HolidayRepository } from "../src/modules/calendar/holiday.repository";
import { GenericReminderRepository } from "../src/modules/reminders/generic-reminder.repository";
import { runGenericReminders } from "../src/modules/reminders/generic-reminder.runner";

describe("generic reminder migration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-generic-reminder-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates generic reminder and holiday tables", () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    try {
      const tables = database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'generic_reminders', 'generic_reminder_attempts',
          'generic_reminder_claims', 'holiday_calendar_days', 'holiday_calendar_syncs'
        ) ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(tables.map(({ name }) => name)).toEqual([
        "generic_reminder_attempts",
        "generic_reminder_claims",
        "generic_reminders",
        "holiday_calendar_days",
        "holiday_calendar_syncs"
      ]);
    } finally {
      database.close();
    }
  });

  it("seeds external check-in and supports reminder CRUD", () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const repository = new GenericReminderRepository(database, new HolidayRepository(database));
    const input = {
      name: "提交报销", enabled: true, lifecycle: "finite" as const, scheduleType: "daily" as const,
      startDate: "2026-08-18", localTime: "09:30", weekdays: [], monthDay: null,
      totalOccurrences: 3, recipient: "me@example.com", subject: "报销提醒", body: "请提交报销"
    };
    const created = repository.create(input, new Date("2026-08-18T00:00:00.000Z"));

    expect(repository.list(new Date("2026-08-18T00:00:00.000Z")).map((item) => item.name)).toEqual(
      expect.arrayContaining(["外勤打卡", "提交报销"])
    );
    expect(repository.update(created.id, { ...input, name: "更新后" }, new Date()).name).toBe("更新后");
    repository.delete(created.id);
    expect(() => repository.get(created.id, new Date())).toThrow("Reminder not found");
    database.close();
  });

  it("counts only successful finite reminder deliveries", async () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const calendar = new HolidayRepository(database);
    const repository = new GenericReminderRepository(database, calendar);
    const reminder = repository.create({
      name: "日报", enabled: true, lifecycle: "finite", scheduleType: "daily",
      startDate: "2026-08-18", localTime: "09:00", weekdays: [], monthDay: null,
      totalOccurrences: 2, recipient: "me@example.com", subject: "日报", body: "请写日报"
    }, new Date("2026-08-18T00:00:00.000Z"));
    const failingChannel = { send: async () => ({ status: "failure" as const, category: "timeout" as const }) };
    const successChannel = { send: async () => ({ status: "success" as const }) };

    await runGenericReminders(new Date("2026-08-18T01:00:00.000Z"), { repository, calendar, channel: failingChannel });
    expect(repository.get(reminder.id, new Date()).successfulOccurrences).toBe(0);
    await runGenericReminders(new Date("2026-08-18T01:01:00.000Z"), { repository, calendar, channel: successChannel });
    expect(repository.get(reminder.id, new Date()).successfulOccurrences).toBe(1);
    expect(repository.listAttempts()[0]).toMatchObject({ reminderName: "日报", status: "success" });
    database.close();
  });

  it("exposes reminder CRUD, history and upcoming routes", async () => {
    const app = createApp({ dataDir: tempDir, now: () => new Date("2026-08-18T00:00:00.000Z") });
    const input = {
      name: "提交报销", enabled: true, lifecycle: "once", scheduleType: "once",
      startDate: "2026-08-18", localTime: "09:30", weekdays: [], monthDay: null,
      totalOccurrences: null, recipient: "me@example.com", subject: "报销提醒", body: "请提交报销"
    };
    const created = await request(app).post("/api/reminders").send(input);
    expect(created.status).toBe(201);
    expect((await request(app).get("/api/reminders")).body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.body.id, name: "提交报销" })])
    );
    expect((await request(app).put(`/api/reminders/${created.body.id}`).send({ ...input, name: "更新后" })).body.name)
      .toBe("更新后");
    expect((await request(app).get("/api/dashboard/upcoming-reminders")).body.items[0]).toHaveProperty("nextRun");
    expect((await request(app).get("/api/reminder-attempts")).body.items).toEqual([]);
    expect((await request(app).delete(`/api/reminders/${created.body.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/reminders/${created.body.id}`)).status).toBe(404);
  });
});

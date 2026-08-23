import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { HolidayRepository } from "../src/modules/calendar/holiday.repository";
import { GenericReminderRepository } from "../src/modules/reminders/generic-reminder.repository";

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

  it("exposes reminder CRUD, history, upcoming and manual email routes without a scheduler", async () => {
    const channel = { send: vi.fn().mockResolvedValue({ status: "success" as const }) };
    const app = createApp({
      dataDir: tempDir,
      now: () => new Date("2026-08-18T00:00:00.000Z"),
      reminderChannel: channel
    });
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
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const repository = new GenericReminderRepository(database, new HolidayRepository(database));
    const saved = repository.get(created.body.id, new Date("2026-08-18T00:00:00.000Z"));
    const scheduledFor = "2026-08-18T01:30:00.000Z";
    const token = "manual-history-fixture";
    expect(repository.acquireClaim(saved.id, scheduledFor, token, new Date("2026-08-18T01:30:00.000Z"), new Date("2026-08-18T01:31:00.000Z"))).toBe(true);
    expect(repository.completeSuccess(saved, scheduledFor, token, new Date("2026-08-18T01:30:05.000Z"))).toBe(true);
    database.close();
    expect((await request(app).get("/api/reminder-attempts")).body.items).toEqual([
      expect.objectContaining({ reminderId: created.body.id, reminderName: "更新后", status: "success" })
    ]);
    expect((await request(app).post(`/api/reminders/${created.body.id}/test`)).body).toEqual({
      status: "success",
      message: "测试邮件已发送"
    });
    expect(channel.send).toHaveBeenCalledWith({
      to: "me@example.com",
      subject: "报销提醒",
      body: "请提交报销"
    });
    expect((await request(app).delete(`/api/reminders/${created.body.id}`)).status).toBe(204);
    expect((await request(app).get(`/api/reminders/${created.body.id}`)).status).toBe(404);
    await request(app).get("/api/reminder-scheduler/status").expect(404);
    await request(app).post("/api/reminder-scheduler/sync").expect(404);
  });
});

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
import { runGenericReminders } from "../src/modules/reminders/generic-reminder.runner";
import { nextReminderWake } from "../src/modules/reminders/reminder-wake";
import { ReminderSchedulerService } from "../src/modules/reminders/reminder-scheduler";

describe("one-click reminder scheduler", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-reminder-scheduler-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("executes only the fixed project script and parses its status", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ installed: true, synchronized: true, taskName: "LYJWorkBench-ReminderRunner", message: "已同步" }),
      stderr: ""
    });
    const service = new ReminderSchedulerService("C:\\project", run);

    await expect(service.sync()).resolves.toMatchObject({ installed: true, synchronized: true });
    expect(run).toHaveBeenCalledWith("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      "C:\\project\\scripts\\sync-reminder-task.ps1", "-ProjectRoot", "C:\\project"
    ]);
  });

  it("exposes scheduler status and sync actions", async () => {
    const scheduler = {
      status: vi.fn().mockResolvedValue({ installed: false, synchronized: false, taskName: "LYJWorkBench-ReminderRunner", message: "尚未同步" }),
      sync: vi.fn().mockResolvedValue({ installed: true, synchronized: true, taskName: "LYJWorkBench-ReminderRunner", message: "已同步" })
    };
    const app = createApp({ dataDir: tempDir, reminderScheduler: scheduler });

    expect((await request(app).get("/api/reminder-scheduler/status")).body.installed).toBe(false);
    expect((await request(app).post("/api/reminder-scheduler/sync")).body.synchronized).toBe(true);
    expect(scheduler.sync).toHaveBeenCalledTimes(1);
  });

  it("selects the earliest future reminder without polling", () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const calendar = new HolidayRepository(database);
    const repository = new GenericReminderRepository(database, calendar);
    const now = new Date("2026-08-18T00:00:00.000Z");
    const base = {
      enabled: true, lifecycle: "once" as const, scheduleType: "once" as const,
      startDate: "2026-08-18", weekdays: [], monthDay: null, totalOccurrences: null,
      recipient: "me@example.com", subject: "提醒", body: "提醒"
    };
    repository.create({ ...base, name: "较晚", localTime: "10:00" }, now);
    repository.create({ ...base, name: "较早", localTime: "09:00" }, now);

    expect(nextReminderWake(now, repository, calendar)?.toISOString()).toBe("2026-08-18T01:00:00.000Z");
    database.close();
  });

  it("retries an overdue failure after five minutes and leaves no wake for a success", async () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const calendar = new HolidayRepository(database);
    const repository = new GenericReminderRepository(database, calendar);
    const now = new Date("2026-08-18T00:00:00.000Z");
    const reminder = repository.create({
      name: "到期提醒", enabled: true, lifecycle: "once", scheduleType: "once",
      startDate: "2026-08-18", localTime: "08:00", weekdays: [], monthDay: null,
      totalOccurrences: null, recipient: "me@example.com", subject: "提醒", body: "提醒"
    }, new Date("2026-08-17T23:00:00.000Z"));

    await runGenericReminders(now, {
      repository, calendar,
      channel: { send: async () => ({ status: "failure" as const, category: "timeout" as const }) }
    });
    expect(nextReminderWake(now, repository, calendar)?.toISOString()).toBe("2026-08-18T00:05:00.000Z");

    await runGenericReminders(new Date("2026-08-18T00:05:00.000Z"), {
      repository, calendar,
      channel: { send: async () => ({ status: "success" as const }) }
    });
    expect(repository.get(reminder.id, now).successfulOccurrences).toBe(1);
    expect(nextReminderWake(new Date("2026-08-18T00:05:00.000Z"), repository, calendar)).toBeNull();
    database.close();
  });
});

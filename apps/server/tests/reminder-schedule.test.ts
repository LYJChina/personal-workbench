import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { GenericReminderInput } from "@workbench/contracts";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { HolidayRepository } from "../src/modules/calendar/holiday.repository";
import { WORKBENCH_MUTATION_HEADER_NAME, WORKBENCH_MUTATION_HEADER_VALUE } from "@workbench/contracts";
import { nextOccurrence } from "../src/modules/reminders/reminder.schedule";
import { createApp } from "../src/app";

const baseReminder: GenericReminderInput & { successfulOccurrences: number } = {
  name: "提醒", enabled: true, lifecycle: "recurring", scheduleType: "daily",
  startDate: "2026-08-18", localTime: "09:00", weekdays: [], monthDay: null,
  totalOccurrences: null, successfulOccurrences: 0, recipient: "me@example.com",
  subject: "提醒", body: "正文"
};

describe("holiday-aware reminder schedules", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-reminder-schedule-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores a known year and distinguishes holidays, makeup days and ordinary dates", () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const repository = new HolidayRepository(database);
    repository.replaceYear(2026, [
      { localDate: "2026-10-01", dayType: "holiday", name: "国庆节" },
      { localDate: "2026-10-10", dayType: "makeup_workday", name: "调休补班" }
    ], "test", new Date("2026-08-18T00:00:00.000Z"));

    expect(repository.isWorkday("2026-10-01")).toBe(false);
    expect(repository.isWorkday("2026-10-10")).toBe(true);
    expect(repository.isWorkday("2026-10-09")).toBe(true);
    expect(repository.isWorkday("2026-10-11")).toBe(false);
    expect(repository.isWorkday("2027-01-04")).toBeNull();
    database.close();
  });

  it("calculates daily, weekly and monthly occurrences in China time", () => {
    const after = new Date("2026-08-18T01:00:00.000Z");
    const unknownCalendar = { isWorkday: () => null };
    expect(nextOccurrence(baseReminder, after, unknownCalendar)?.toISOString()).toBe("2026-08-19T01:00:00.000Z");
    expect(nextOccurrence({ ...baseReminder, scheduleType: "weekly", weekdays: [1] }, after, unknownCalendar)?.toISOString())
      .toBe("2026-08-24T01:00:00.000Z");
    expect(nextOccurrence({ ...baseReminder, scheduleType: "monthly", monthDay: 18 }, after, unknownCalendar)?.toISOString())
      .toBe("2026-09-18T01:00:00.000Z");
  });

  it("uses statutory workdays and blocks an unknown year", () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const repository = new HolidayRepository(database);
    repository.replaceYear(2026, [
      ...Array.from({ length: 8 }, (_, index) => ({
        localDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
        dayType: "holiday" as const,
        name: "国庆节"
      })),
      { localDate: "2026-10-10", dayType: "makeup_workday", name: "调休补班" }
    ], "test", new Date());
    const reminder = { ...baseReminder, scheduleType: "workday" as const, startDate: "2026-10-01" };

    expect(nextOccurrence(reminder, new Date("2026-09-30T16:00:00.000Z"), repository)?.toISOString())
      .toBe("2026-10-09T01:00:00.000Z");
    expect(nextOccurrence({ ...reminder, startDate: "2027-01-01" }, new Date("2026-12-31T16:00:00.000Z"), repository))
      .toBeNull();
    database.close();
  });

  it("synchronizes requested holiday years and returns cached calendar data", async () => {
    const app = createApp({
      dataDir: tempDir,
      holidayYearLoader: async (year: number) => year === 2026 ? [
        { localDate: "2026-10-01", dayType: "holiday", name: "国庆节" },
        { localDate: "2026-10-10", dayType: "makeup_workday", name: "国庆节调休" }
      ] : null,
      now: () => new Date("2026-08-18T00:00:00.000Z")
    });

    const synchronized = await request(app).post("/api/calendar/sync").send({ years: [2026, 2027] });
    expect(synchronized.status).toBe(200);
    expect(synchronized.body).toEqual({ updatedYears: [2026], unavailableYears: [2027] });
    const calendar = await request(app).get("/api/calendar?from=2026-10-01&to=2026-10-10");
    expect(calendar.body.coverage[0].year).toBe(2026);
    expect(calendar.body.days).toContainEqual({ localDate: "2026-10-10", dayType: "makeup_workday", name: "国庆节调休" });
  });

  it("aborts a pending holiday fetch before opening or mutating the calendar database", async () => {
    let observedSignal: AbortSignal | undefined;
    let started!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { started = resolve; });
    const app = createApp({
      dataDir: tempDir,
      holidayYearLoader: async (_year, signal) => {
        observedSignal = signal;
        started();
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
      }
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    const body = JSON.stringify({ years: [2026] });
    const aborted = new Promise<void>((resolve) => {
      const pending = httpRequest({
        host: "127.0.0.1", port: address.port, path: "/api/calendar/sync", method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), [WORKBENCH_MUTATION_HEADER_NAME]: WORKBENCH_MUTATION_HEADER_VALUE }
      });
      pending.on("error", () => resolve());
      pending.end(body);
      void fetchStarted.then(() => pending.destroy());
    });
    await aborted;
    expect(observedSignal?.aborted).toBe(true);
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    expect(new HolidayRepository(database).coverage()).toEqual([]);
    database.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

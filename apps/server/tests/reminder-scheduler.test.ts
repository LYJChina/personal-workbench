import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
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
});

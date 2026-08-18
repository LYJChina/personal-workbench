import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);

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
      stdout: JSON.stringify({ installed: true, synchronized: true, taskName: "LYJWorkBench-ReminderRunner", message: "已同步", nextRun: "2026-08-18T01:00:00.000Z" }),
      stderr: ""
    });
    const service = new ReminderSchedulerService("C:\\project", run);

    await expect(service.sync()).resolves.toMatchObject({ installed: true, synchronized: true, nextRun: "2026-08-18T01:00:00.000Z" });
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

  it("registers one invisible non-repeating task at the next wake-up", async () => {
    const projectRoot = join(tempDir, "one shot project");
    const entryPath = join(projectRoot, "apps", "server", "dist", "reminder-entry.cjs");
    const launcherPath = join(projectRoot, "scripts", "run-reminders-hidden.vbs");
    const wrapper = join(tempDir, "controlled-one-shot.ps1");
    const actionMarker = join(tempDir, "action.txt");
    const triggerMarker = join(tempDir, "trigger.txt");
    const settingsMarker = join(tempDir, "settings.txt");
    const script = resolve(process.cwd(), "../../scripts/sync-reminder-task.ps1");
    await mkdir(join(projectRoot, "apps", "server", "dist"), { recursive: true });
    await mkdir(join(projectRoot, "scripts"), { recursive: true });
    await writeFile(entryPath, `if (process.argv[2] === "--next-wake") console.log(JSON.stringify({ nextRun: "2026-08-18T01:00:00.000Z" }));`);
    await writeFile(launcherPath, "WScript.Quit 0");
    await writeFile(wrapper, `
      param([string]$Script, [string]$ProjectRoot, [string]$NodePath, [string]$EntryPath)
      $script:Registered = $false
      function Get-ScheduledTask {
        param($TaskPath, $TaskName, $ErrorAction)
        if ($TaskName -eq 'LYJWorkBench-OutboundCheckin' -or -not $script:Registered) { return $null }
        return [pscustomobject]@{ TaskPath = '\\'; TaskName = $TaskName }
      }
      function New-ScheduledTaskAction {
        param($Execute, $Argument, $WorkingDirectory)
        Set-Content -LiteralPath $env:LYJ_ACTION -Value ($Execute + '|' + $Argument + '|' + $WorkingDirectory)
        return [pscustomobject]@{}
      }
      function New-ScheduledTaskTrigger {
        param([switch]$Once, $At, $RepetitionInterval, $RepetitionDuration)
        Set-Content -LiteralPath $env:LYJ_TRIGGER -Value ($Once.IsPresent.ToString() + '|' + $At.ToString('o') + '|' + [string]$RepetitionInterval)
        return [pscustomobject]@{ Repetition = [pscustomobject]@{ Interval = $null; Duration = $null } }
      }
      function New-ScheduledTaskSettingsSet {
        param([switch]$StartWhenAvailable, $RestartCount, $RestartInterval, [switch]$Hidden)
        Set-Content -LiteralPath $env:LYJ_SETTINGS -Value ($StartWhenAvailable.IsPresent.ToString() + '|' + $RestartCount + '|' + $RestartInterval.TotalMinutes)
        return [pscustomobject]@{}
      }
      function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) return [pscustomobject]@{} }
      function Register-ScheduledTask { param($TaskPath, $TaskName, $Action, $Trigger, $Settings, $Principal, $Description, [switch]$Force) $script:Registered = $true }
      function Unregister-ScheduledTask { throw 'Unexpected unregister' }
      & $Script -ProjectRoot $ProjectRoot -NodePath $NodePath -ReminderEntryPath $EntryPath -Confirm:$false
    `);

    const result = await execFileAsync("powershell", [
      "-NoProfile", "-File", wrapper, "-Script", script, "-ProjectRoot", projectRoot,
      "-NodePath", process.execPath, "-EntryPath", entryPath
    ], { env: { ...process.env, LYJ_ACTION: actionMarker, LYJ_TRIGGER: triggerMarker, LYJ_SETTINGS: settingsMarker } });

    expect(result.stderr).toBe("");
    expect((await readFile(actionMarker, "utf8")).toLowerCase()).toContain("wscript.exe");
    expect((await readFile(actionMarker, "utf8")).toLowerCase()).toContain("run-reminders-hidden.vbs");
    expect((await readFile(triggerMarker, "utf8")).trim()).toMatch(/^True\|.*\|$/);
    expect((await readFile(settingsMarker, "utf8")).trim()).toBe("True|3|5");
    expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? "{}")).toMatchObject({
      installed: true, synchronized: true, nextRun: "2026-08-18T01:00:00.000Z"
    });
  });

  it("removes the exact task and returns a null wake-up when nothing is pending", async () => {
    const projectRoot = join(tempDir, "empty schedule");
    const entryPath = join(projectRoot, "apps", "server", "dist", "reminder-entry.cjs");
    const launcherPath = join(projectRoot, "scripts", "run-reminders-hidden.vbs");
    const wrapper = join(tempDir, "controlled-empty.ps1");
    const removalMarker = join(tempDir, "removed.txt");
    const script = resolve(process.cwd(), "../../scripts/sync-reminder-task.ps1");
    await mkdir(join(projectRoot, "apps", "server", "dist"), { recursive: true });
    await mkdir(join(projectRoot, "scripts"), { recursive: true });
    await writeFile(entryPath, `if (process.argv[2] === "--next-wake") console.log(JSON.stringify({ nextRun: null }));`);
    await writeFile(launcherPath, "WScript.Quit 0");
    await writeFile(wrapper, `
      param([string]$Script, [string]$ProjectRoot, [string]$NodePath, [string]$EntryPath)
      $global:LYJTaskExists = $true
      function Get-ScheduledTask {
        param($TaskPath, $TaskName, $ErrorAction)
        if ($TaskName -eq 'LYJWorkBench-OutboundCheckin' -or -not $global:LYJTaskExists) { return $null }
        return [pscustomobject]@{ TaskPath = '\\'; TaskName = $TaskName }
      }
      function Unregister-ScheduledTask { param($TaskPath, $TaskName, $Confirm) $global:LYJTaskExists = $false; Set-Content -LiteralPath $env:LYJ_REMOVED -Value ($TaskPath + $TaskName) }
      & $Script -ProjectRoot $ProjectRoot -NodePath $NodePath -ReminderEntryPath $EntryPath -Confirm:$false
    `);

    const result = await execFileAsync("powershell", [
      "-NoProfile", "-File", wrapper, "-Script", script, "-ProjectRoot", projectRoot,
      "-NodePath", process.execPath, "-EntryPath", entryPath
    ], { env: { ...process.env, LYJ_REMOVED: removalMarker } });
    expect((await readFile(removalMarker, "utf8")).trim()).toBe("\\LYJWorkBench-ReminderRunner");
    expect(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? "{}")).toEqual({
      installed: false, synchronized: true, taskName: "LYJWorkBench-ReminderRunner",
      message: "No pending reminders", nextRun: null
    });
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

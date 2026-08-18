import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { parseReminderArguments } from "../src/reminder-entry";
import { EmailNotificationChannel, type MailTransportFactory } from "../src/modules/reminders/email-channel";
import type { DeliveryResult, NotificationChannel, NotificationMessage } from "../src/modules/reminders/notification-channel";
import { ReminderRepository } from "../src/modules/reminders/reminder.repository";
import { runDueReminders } from "../src/modules/reminders/reminder.runner";
import { SettingsRepository } from "../src/modules/settings/settings.repository";
import type { SecretStore } from "../src/platform/dpapi";

const execFileAsync = promisify(execFile);
const mondayAtNine = new Date("2026-08-24T09:00:00+08:00");

class MemorySecretStore implements SecretStore {
  public reads = 0;
  private readonly secrets = new Map<string, string>();

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    this.secrets.set(name, plaintext);
  }

  public async readSecret(name: string): Promise<string | null> {
    this.reads += 1;
    return this.secrets.get(name) ?? null;
  }
}

class RecordingChannel implements NotificationChannel {
  public readonly messages: NotificationMessage[] = [];

  public constructor(
    private readonly outcome: DeliveryResult = { status: "success" },
    private readonly beforeResolve?: () => void
  ) {}

  public async send(message: NotificationMessage): Promise<DeliveryResult> {
    this.messages.push(message);
    this.beforeResolve?.();
    return this.outcome;
  }
}

describe("Monday outbound check-in reminder", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-reminder-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function openRepository() {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    return { database, repository: new ReminderRepository(database) };
  }

  it("seeds a disabled Monday 09:00 China-time rule with outbound check-in copy", () => {
    const { database, repository } = openRepository();
    try {
      const reminder = repository.get("outbound-checkin", new Date("2026-08-23T08:00:00+08:00"));
      expect(reminder).toMatchObject({
        id: "outbound-checkin",
        enabled: false,
        weekday: 1,
        localTime: "09:00",
        recipient: "",
        subject: "提交外勤打卡提醒",
        body: "请提交本周外勤打卡。",
        nextRun: null,
        lastSuccess: null,
        lastFailure: null
      });
    } finally {
      database.close();
    }
  });

  it("accepts only the known reminder ID at the command-line boundary", () => {
    expect(parseReminderArguments(["--reminder", "outbound-checkin"])).toBe("outbound-checkin");
    expect(() => parseReminderArguments(["--reminder", "other"])).toThrow("Invalid reminder arguments");
    expect(() => parseReminderArguments(["--reminder", "outbound-checkin", "--extra"])).toThrow("Invalid reminder arguments");
  });

  it("sends an enabled due reminder once for the China local calendar date", async () => {
    const { database, repository } = openRepository();
    repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const channel = new RecordingChannel({ status: "success" }, () => {
      expect(repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(false);
    });

    const first = await runDueReminders(mondayAtNine, { repository, channel });
    const second = await runDueReminders(mondayAtNine, { repository, channel });

    expect(first).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(second).toEqual({ checked: 1, sent: 0, failed: 0 });
    expect(channel.messages).toEqual([{
      to: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }]);
    expect(repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(true);
    expect(repository.get("outbound-checkin", mondayAtNine).lastSuccess).toMatchObject({ localDate: "2026-08-24" });
    database.close();
  });

  it.each([
    ["disabled", false, "2026-08-24T09:00:00+08:00"],
    ["wrong weekday", true, "2026-08-25T09:00:00+08:00"],
    ["before scheduled time", true, "2026-08-24T08:59:59+08:00"]
  ])("does not send when %s", async (_label, enabled, value) => {
    const { database, repository } = openRepository();
    repository.save("outbound-checkin", {
      enabled,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, new Date(value));
    const channel = new RecordingChannel();

    const summary = await runDueReminders(new Date(value), { repository, channel });

    expect(summary).toEqual({ checked: 1, sent: 0, failed: 0 });
    expect(channel.messages).toEqual([]);
    database.close();
  });

  it("records one sanitized failure without marking the local date delivered", async () => {
    const { database, repository } = openRepository();
    repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const secretBearingServerText = "smtp://user:raw-password@smtp.example.com rejected 535";
    const channel = new RecordingChannel({ status: "failure", category: "auth_failure" });

    const summary = await runDueReminders(mondayAtNine, { repository, channel });

    expect(summary).toEqual({ checked: 1, sent: 0, failed: 1 });
    expect(channel.messages).toHaveLength(1);
    expect(repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(false);
    const reminder = repository.get("outbound-checkin", mondayAtNine);
    expect(reminder.lastFailure).toMatchObject({ localDate: "2026-08-24", category: "auth_failure" });
    expect(JSON.stringify(reminder)).not.toContain(secretBearingServerText);
    database.close();
  });

  it("loads the SMTP password at send time and applies exact TLS modes without leaking credentials", async () => {
    const secretStore = new MemorySecretStore();
    const settings = {
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      transportMode: "starttls" as const,
      smtpUsername: "sender@example.com",
      fromAddress: "sender@example.com",
      smtpPasswordConfigured: true
    };
    const configs: unknown[] = [];
    const sent: unknown[] = [];
    const transportFactory: MailTransportFactory = (configuration) => {
      configs.push(configuration);
      return {
        sendMail: async (message) => {
          sent.push(message);
          return { response: "250 raw-password accepted", messageId: "server-secret-id" };
        },
        close: () => undefined
      };
    };
    const channel = new EmailNotificationChannel({
      secretStore,
      loadSettings: () => settings,
      transportFactory,
      timeoutMs: 4_321
    });
    expect(secretStore.reads).toBe(0);
    await secretStore.protectSecret("smtp-password", "raw-password");

    const starttls = await channel.send({ to: "me@example.com", subject: "提醒", body: "提交外勤打卡" });

    expect(secretStore.reads).toBe(1);
    expect(configs[0]).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "sender@example.com", pass: "raw-password" },
      connectionTimeout: 4_321,
      greetingTimeout: 4_321,
      socketTimeout: 4_321,
      tls: { servername: "smtp.example.com" }
    });
    expect(sent).toEqual([{ from: "sender@example.com", to: "me@example.com", subject: "提醒", text: "提交外勤打卡" }]);
    expect(starttls).toEqual({ status: "success" });
    expect(JSON.stringify(starttls)).not.toMatch(/raw-password|250|server-secret-id/);

    const tlsConfigs: unknown[] = [];
    const tlsChannel = new EmailNotificationChannel({
      secretStore,
      loadSettings: () => ({ ...settings, smtpPort: 465, transportMode: "tls" }),
      transportFactory: (configuration) => {
        tlsConfigs.push(configuration);
        return { sendMail: async () => ({}), close: () => undefined };
      }
    });
    await tlsChannel.send({ to: "me@example.com", subject: "提醒", body: "正文" });
    expect(tlsConfigs[0]).toMatchObject({ secure: true, requireTLS: false });
  });

  it("validates complete SMTP settings and returns only sanitized failure categories", async () => {
    const secretStore = new MemorySecretStore();
    const factory = vi.fn(() => ({ sendMail: async () => ({}), close: () => undefined }));
    const missingPassword = new EmailNotificationChannel({
      secretStore,
      loadSettings: () => ({
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        transportMode: "starttls",
        smtpUsername: "sender@example.com",
        fromAddress: "sender@example.com",
        smtpPasswordConfigured: false
      }),
      transportFactory: factory
    });
    expect(await missingPassword.send({ to: "me@example.com", subject: "提醒", body: "正文" })).toEqual({
      status: "failure",
      category: "not_configured"
    });
    expect(factory).not.toHaveBeenCalled();

    await secretStore.protectSecret("smtp-password", "raw-password");
    const failed = new EmailNotificationChannel({
      secretStore,
      loadSettings: () => ({
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        transportMode: "starttls",
        smtpUsername: "sender@example.com",
        fromAddress: "sender@example.com",
        smtpPasswordConfigured: true
      }),
      transportFactory: () => ({
        sendMail: async () => { throw Object.assign(new Error("raw-password 535 response"), { code: "EAUTH" }); },
        close: () => undefined
      })
    });
    const result = await failed.send({ to: "me@example.com", subject: "提醒", body: "正文" });
    expect(result).toEqual({ status: "failure", category: "auth_failure" });
    expect(JSON.stringify(result)).not.toMatch(/raw-password|535|response/);
  });

  it("validates GET/PUT fields and maps test-send success and failure truthfully", async () => {
    const successChannel = new RecordingChannel();
    const app = createApp({ dataDir: tempDir, secretStore: new MemorySecretStore(), reminderChannel: successChannel, now: () => mondayAtNine });
    const loaded = await request(app).get("/api/reminders/outbound-checkin");
    expect(loaded.status).toBe(200);
    expect(loaded.body).toMatchObject({ id: "outbound-checkin", weekday: 1, localTime: "09:00" });

    const valid = {
      enabled: true,
      localTime: "10:15",
      recipient: "me@example.com",
      subject: "请提交外勤打卡",
      body: "请在今天完成本周外勤打卡提交。"
    };
    expect((await request(app).put("/api/reminders/outbound-checkin").send(valid)).status).toBe(200);
    for (const invalid of [
      { ...valid, recipient: "not-an-email" },
      { ...valid, localTime: "25:00" },
      { ...valid, subject: "" },
      { ...valid, body: "" },
      { ...valid, enabled: "yes" }
    ]) {
      expect((await request(app).put("/api/reminders/outbound-checkin").send(invalid)).status).toBe(400);
    }
    const testSuccess = await request(app).post("/api/reminders/outbound-checkin/test");
    expect(testSuccess.body).toEqual({ status: "success", message: "测试邮件已发送" });
    expect(successChannel.messages).toEqual([{ to: "me@example.com", subject: "请提交外勤打卡", body: "请在今天完成本周外勤打卡提交。" }]);

    const failureApp = createApp({
      dataDir: tempDir,
      secretStore: new MemorySecretStore(),
      reminderChannel: new RecordingChannel({ status: "failure", category: "timeout" }),
      now: () => mondayAtNine
    });
    const testFailure = await request(failureApp).post("/api/reminders/outbound-checkin/test");
    expect(testFailure.body).toEqual({ status: "failure", category: "timeout", message: "测试邮件发送失败" });
    expect(JSON.stringify(testFailure.body)).not.toMatch(/smtp|password|server/i);
  });

  it("sanitizes a rejected test-send channel before the API and logger boundaries", async () => {
    const rawSecret = "smtp://sender:raw-password@smtp.example.com 535 rejected";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const channel: NotificationChannel = { send: async () => { throw new Error(rawSecret); } };
    const app = createApp({ dataDir: tempDir, secretStore: new MemorySecretStore(), reminderChannel: channel, now: () => mondayAtNine });
    await request(app).put("/api/reminders/outbound-checkin").send({
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }).expect(200);

    const response = await request(app).post("/api/reminders/outbound-checkin/test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "failure", category: "unknown", message: "测试邮件发送失败" });
    expect(JSON.stringify(response.body)).not.toContain(rawSecret);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(rawSecret);
  });

  it("persists settings and attempt status for a fresh app and repository", async () => {
    const app = createApp({ dataDir: tempDir, secretStore: new MemorySecretStore(), reminderChannel: new RecordingChannel(), now: () => mondayAtNine });
    await request(app).put("/api/reminders/outbound-checkin").send({
      enabled: true,
      localTime: "09:00",
      recipient: "persisted@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }).expect(200);

    const first = openRepository();
    await runDueReminders(mondayAtNine, { repository: first.repository, channel: new RecordingChannel() });
    first.database.close();

    const freshApp = createApp({ dataDir: tempDir, secretStore: new MemorySecretStore(), reminderChannel: new RecordingChannel(), now: () => mondayAtNine });
    const loaded = await request(freshApp).get("/api/reminders/outbound-checkin");
    expect(loaded.body).toMatchObject({ recipient: "persisted@example.com", lastSuccess: { localDate: "2026-08-24" } });
    const fresh = openRepository();
    expect(fresh.repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(true);
    fresh.database.close();
  });

  it("executes the installer in WhatIf mode against controlled paths without changing task state", async () => {
    const controlledRoot = join(tempDir, "controlled project");
    const fakeNode = join(controlledRoot, "runtime", "node.exe");
    const fakeEntry = join(controlledRoot, "apps", "server", "dist", "reminder-entry.js");
    await mkdir(join(controlledRoot, "runtime"), { recursive: true });
    await mkdir(join(controlledRoot, "apps", "server", "dist"), { recursive: true });
    await writeFile(fakeNode, "controlled-node");
    await writeFile(fakeEntry, "controlled-entry");
    const script = resolve(process.cwd(), "../../scripts/install-reminder-task.ps1");

    const { stdout, stderr } = await execFileAsync("powershell", [
      "-NoProfile", "-File", script, "-WhatIf", "-ProjectRoot", controlledRoot,
      "-NodePath", fakeNode, "-ReminderEntryPath", fakeEntry, "-LocalTime", "10:15"
    ]);

    expect(stderr).toBe("");
    expect(stdout.match(/LYJWorkBench-OutboundCheckin/g)).toHaveLength(1);
    expect(stdout).toContain("Monday 10:15");
    expect(stdout).toContain(fakeNode);
    expect(stdout).toContain(fakeEntry);

    const defaultRoot = await execFileAsync("powershell", [
      "-NoProfile", "-File", script, "-WhatIf", "-NodePath", fakeNode,
      "-ReminderEntryPath", fakeEntry, "-LocalTime", "10:15"
    ]);
    expect(defaultRoot.stderr).toBe("");
    expect(defaultRoot.stdout).toContain(resolve(process.cwd(), "../.."));
  });
});

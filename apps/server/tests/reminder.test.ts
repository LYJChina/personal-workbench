import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { EmailNotificationChannel, type MailTransportFactory } from "../src/modules/reminders/email-channel";
import type { DeliveryResult, NotificationChannel, NotificationMessage } from "../src/modules/reminders/notification-channel";
import { ReminderRepository } from "../src/modules/reminders/reminder.repository";
import type { SecretStore } from "../src/platform/secret-store";

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

  public constructor(private readonly outcome: DeliveryResult = { status: "success" }) {}

  public async send(message: NotificationMessage): Promise<DeliveryResult> {
    this.messages.push(message);
    return this.outcome;
  }
}

describe("manual outbound check-in email", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-reminder-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("keeps reminder timing metadata without exposing scheduler instructions", () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    try {
      const reminder = new ReminderRepository(database).get("outbound-checkin", new Date("2026-08-23T08:00:00+08:00"));
      expect(reminder).toEqual({
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

  it("loads the SMTP password only when manually sending and applies exact TLS modes", async () => {
    const secretStore = new MemorySecretStore();
    await secretStore.protectSecret("smtp-password", "raw-password");
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
      loadSettings: () => ({
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        transportMode: "starttls",
        smtpUsername: "sender@example.com",
        fromAddress: "sender@example.com",
        smtpPasswordConfigured: true
      }),
      transportFactory,
      timeoutMs: 4_321
    });

    expect(secretStore.reads).toBe(0);
    const result = await channel.send({ to: "me@example.com", subject: "提醒", body: "提交外勤打卡" });

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
    expect(result).toEqual({ status: "success" });
    expect(JSON.stringify(result)).not.toMatch(/raw-password|250|server-secret-id/);
  });

  it("keeps SMTP validation and sanitized failures", async () => {
    const secretStore = new MemorySecretStore();
    const factory = vi.fn(() => ({ sendMail: async () => ({}), close: () => undefined }));
    const channel = new EmailNotificationChannel({
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

    expect(await channel.send({ to: "me@example.com", subject: "提醒", body: "正文" })).toEqual({
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

  it("validates reminder updates and maps manual test-send results truthfully", async () => {
    const successChannel = new RecordingChannel();
    const app = createApp({
      dataDir: tempDir,
      secretStore: new MemorySecretStore(),
      reminderChannel: successChannel,
      now: () => mondayAtNine
    });
    const valid = {
      enabled: true,
      localTime: "10:15",
      recipient: "me@example.com",
      subject: "请提交外勤打卡",
      body: "请在今天完成本周外勤打卡提交。"
    };

    expect((await request(app).put("/api/reminders/outbound-checkin").send(valid)).status).toBe(200);
    expect((await request(app).put("/api/reminders/outbound-checkin").send({ ...valid, recipient: "not-an-email" })).status).toBe(400);
    expect((await request(app).post("/api/reminders/outbound-checkin/test")).body).toEqual({
      status: "success",
      message: "测试邮件已发送"
    });
    expect(successChannel.messages).toEqual([{
      to: "me@example.com",
      subject: "请提交外勤打卡",
      body: "请在今天完成本周外勤打卡提交。"
    }]);

    const failureApp = createApp({
      dataDir: tempDir,
      secretStore: new MemorySecretStore(),
      reminderChannel: new RecordingChannel({ status: "failure", category: "timeout" }),
      now: () => mondayAtNine
    });
    expect((await request(failureApp).post("/api/reminders/outbound-checkin/test")).body).toEqual({
      status: "failure",
      category: "timeout",
      message: "测试邮件发送失败"
    });
  });

  it("sanitizes a rejected manual email before API and log boundaries", async () => {
    const rawSecret = "smtp://sender:raw-password@smtp.example.com 535 rejected";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({
      dataDir: tempDir,
      secretStore: new MemorySecretStore(),
      reminderChannel: { send: async () => { throw new Error(rawSecret); } },
      now: () => mondayAtNine
    });
    await request(app).put("/api/reminders/outbound-checkin").send({
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }).expect(200);

    const response = await request(app).post("/api/reminders/outbound-checkin/test");

    expect(response.body).toEqual({ status: "failure", category: "unknown", message: "测试邮件发送失败" });
    expect(JSON.stringify(response.body)).not.toContain(rawSecret);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(rawSecret);
  });

  it("propagates a locked default vault from both manual email endpoints", async () => {
    const app = createApp({ dataDir: tempDir, vaultScrypt: { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 } });
    const input = {
      name: "锁定测试", enabled: true, lifecycle: "once", scheduleType: "once",
      startDate: "2026-08-24", localTime: "09:30", weekdays: [], monthDay: null,
      totalOccurrences: null, recipient: "me@example.com", subject: "测试", body: "正文"
    };
    const created = await request(app).post("/api/reminders").send(input).expect(201);

    await request(app).post("/api/reminders/outbound-checkin/test").expect(423, {
      error: { message: "保险库已锁定", code: "VAULT_LOCKED" }
    });
    await request(app).post(`/api/reminders/${created.body.id}/test`).expect(423, {
      error: { message: "保险库已锁定", code: "VAULT_LOCKED" }
    });
  });

  it("propagates vault integrity failures from both manual email endpoints", async () => {
    const app = createApp({ dataDir: tempDir, vaultScrypt: { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 } });
    await request(app).post("/api/vault/setup").send({ masterPassword: "correct horse battery staple" }).expect(201);
    await request(app).put("/api/settings/mail").send({
      smtpHost: "smtp.example.com", smtpPort: 587, transportMode: "starttls",
      smtpUsername: "sender@example.com", fromAddress: "sender@example.com", smtpPassword: "secret-password"
    }).expect(200);
    const created = await request(app).post("/api/reminders").send({
      name: "完整性测试", enabled: true, lifecycle: "once", scheduleType: "once",
      startDate: "2026-08-24", localTime: "09:30", weekdays: [], monthDay: null,
      totalOccurrences: null, recipient: "me@example.com", subject: "测试", body: "正文"
    }).expect(201);
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    try {
      const row = database.prepare("SELECT ciphertext FROM vault_secrets WHERE name = 'smtp-password'").get() as { ciphertext: Buffer };
      row.ciphertext[0] ^= 1;
      database.prepare("UPDATE vault_secrets SET ciphertext = ? WHERE name = 'smtp-password'").run(row.ciphertext);
    } finally {
      database.close();
    }

    await request(app).post("/api/reminders/outbound-checkin/test").expect(500, {
      error: { message: "保险库数据无法验证", code: "VAULT_INTEGRITY_ERROR" }
    });
    await request(app).post(`/api/reminders/${created.body.id}/test`).expect(500, {
      error: { message: "保险库数据无法验证", code: "VAULT_INTEGRITY_ERROR" }
    });
  });
});

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { applySchedulerSynchronizationArguments, parseReminderArguments } from "../src/reminder-entry";
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

class ManualHeartbeatTimers {
  public clears = 0;
  public executions = 0;
  public intervalMs: number | null = null;
  private callback: (() => void) | null = null;

  public setInterval(callback: () => void, intervalMs: number): object {
    this.callback = () => {
      this.executions += 1;
      callback();
    };
    this.intervalMs = intervalMs;
    return this;
  }

  public clearInterval(handle: unknown): void {
    if (handle !== this || this.callback === null) return;
    this.callback = null;
    this.clears += 1;
  }

  public fire(): void {
    this.callback?.();
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
        lastFailure: null,
        schedulerReinstallRequired: true,
        schedulerReinstallInstruction: "powershell -NoProfile -File scripts/install-reminder-task.ps1 -LocalTime 09:00"
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

  it("persists scheduler synchronization and flags every configured-time mismatch conservatively", () => {
    const first = openRepository();
    try {
      expect(first.repository.get("outbound-checkin", mondayAtNine).schedulerReinstallRequired).toBe(true);
      expect(applySchedulerSynchronizationArguments(
        ["--reminder", "outbound-checkin", "--scheduler-synchronized-time", "09:00"],
        first.repository,
        new Date("2026-08-18T01:00:00.000Z")
      )).toBe(true);
      expect(first.repository.get("outbound-checkin", mondayAtNine).schedulerReinstallRequired).toBe(false);
      first.repository.save("outbound-checkin", {
        enabled: true,
        localTime: "10:15",
        recipient: "me@example.com",
        subject: "提交外勤打卡提醒",
        body: "请提交本周外勤打卡。"
      }, mondayAtNine);
      expect(first.repository.get("outbound-checkin", mondayAtNine)).toMatchObject({
        schedulerReinstallRequired: true,
        schedulerReinstallInstruction: "powershell -NoProfile -File scripts/install-reminder-task.ps1 -LocalTime 10:15"
      });
    } finally {
      first.database.close();
    }

    const fresh = openRepository();
    try {
      expect(fresh.repository.get("outbound-checkin", mondayAtNine).schedulerReinstallRequired).toBe(true);
      expect(applySchedulerSynchronizationArguments(
        ["--reminder", "outbound-checkin", "--scheduler-synchronized-time", "10:15"],
        fresh.repository,
        new Date("2026-08-18T02:00:00.000Z")
      )).toBe(true);
      expect(fresh.repository.get("outbound-checkin", mondayAtNine).schedulerReinstallRequired).toBe(false);
      expect(() => applySchedulerSynchronizationArguments(
        ["--reminder", "other", "--scheduler-synchronized-time", "10:15"],
        fresh.repository,
        new Date()
      )).toThrow("Invalid scheduler synchronization arguments");
    } finally {
      fresh.database.close();
    }
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

  it("atomically leases one cross-process sender before either SMTP side effect completes", async () => {
    const first = openRepository();
    first.repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const secondDatabase = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const secondRepository = new ReminderRepository(secondDatabase);
    let releaseSend!: () => void;
    const release = new Promise<void>((resolve) => { releaseSend = resolve; });
    let firstSendStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstSendStarted = resolve; });
    let sends = 0;
    const channel: NotificationChannel = {
      send: async () => {
        sends += 1;
        firstSendStarted();
        await release;
        return { status: "success" };
      }
    };

    const firstRun = runDueReminders(mondayAtNine, { repository: first.repository, channel });
    await started;
    const secondRun = runDueReminders(mondayAtNine, { repository: secondRepository, channel });
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseSend();
    const summaries = await Promise.all([firstRun, secondRun]);
    const delivered = first.repository.wasDelivered("outbound-checkin", "2026-08-24");
    first.database.close();
    secondDatabase.close();

    expect(sends).toBe(1);
    expect(summaries).toContainEqual({ checked: 1, sent: 1, failed: 0 });
    expect(summaries).toContainEqual({ checked: 1, sent: 0, failed: 0 });
    expect(delivered).toBe(true);
  });

  it("lets a new token replace an expired lease but not a live lease", () => {
    const { database, repository } = openRepository();
    try {
      expect(repository.acquireDeliveryClaim(
        "outbound-checkin", "2026-08-24", "first-token",
        new Date("2026-08-24T01:00:00.000Z"), new Date("2026-08-24T01:01:00.000Z")
      )).toBe(true);
      expect(repository.acquireDeliveryClaim(
        "outbound-checkin", "2026-08-24", "early-token",
        new Date("2026-08-24T01:00:59.999Z"), new Date("2026-08-24T01:02:00.000Z")
      )).toBe(false);
      expect(repository.acquireDeliveryClaim(
        "outbound-checkin", "2026-08-24", "replacement-token",
        new Date("2026-08-24T01:01:00.000Z"), new Date("2026-08-24T01:02:00.000Z")
      )).toBe(true);
    } finally {
      database.close();
    }
  });

  it("renews expiry only for the matching claim token", () => {
    const { database, repository } = openRepository();
    try {
      expect(repository.acquireDeliveryClaim(
        "outbound-checkin", "2026-08-24", "owner-token",
        new Date("2026-08-24T01:00:00.000Z"), new Date("2026-08-24T01:01:00.000Z")
      )).toBe(true);
      expect(repository.renewClaim(
        "outbound-checkin", "2026-08-24", "stale-token",
        new Date("2026-08-24T01:00:30.000Z"), new Date("2026-08-24T01:02:00.000Z")
      )).toBe(false);
      expect(repository.renewClaim(
        "outbound-checkin", "2026-08-24", "owner-token",
        new Date("2026-08-24T01:00:30.000Z"), new Date("2026-08-24T01:02:00.000Z")
      )).toBe(true);
      expect(repository.acquireDeliveryClaim(
        "outbound-checkin", "2026-08-24", "blocked-token",
        new Date("2026-08-24T01:01:00.000Z"), new Date("2026-08-24T01:03:00.000Z")
      )).toBe(false);
      expect(repository.acquireDeliveryClaim(
        "outbound-checkin", "2026-08-24", "replacement-token",
        new Date("2026-08-24T01:02:00.000Z"), new Date("2026-08-24T01:03:00.000Z")
      )).toBe(true);
    } finally {
      database.close();
    }
  });

  it("heartbeats a pending send beyond its original lease so a second runner cannot send", async () => {
    const first = openRepository();
    first.repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const secondDatabase = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const secondRepository = new ReminderRepository(secondDatabase);
    const timers = new ManualHeartbeatTimers();
    let currentMs = mondayAtNine.getTime();
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    let sends = 0;
    const channel: NotificationChannel = {
      send: async () => {
        sends += 1;
        if (sends === 1) {
          firstStarted();
          await release;
        }
        return { status: "success" };
      }
    };

    const firstRun = runDueReminders(mondayAtNine, {
      repository: first.repository,
      channel,
      claimToken: () => "first-token",
      claimLeaseMs: 100,
      heartbeatIntervalMs: 25,
      clock: () => new Date(currentMs),
      timers
    });
    await started;
    currentMs += 75;
    timers.fire();
    currentMs += 50;
    const secondSummary = await runDueReminders(new Date(currentMs), {
      repository: secondRepository,
      channel,
      claimToken: () => "second-token",
      claimLeaseMs: 100,
      heartbeatIntervalMs: 25,
      clock: () => new Date(currentMs),
      timers: new ManualHeartbeatTimers()
    });
    releaseFirst();
    const firstSummary = await firstRun;
    const delivered = first.repository.wasDelivered("outbound-checkin", "2026-08-24");
    first.database.close();
    secondDatabase.close();

    expect(sends).toBe(1);
    expect(secondSummary).toEqual({ checked: 1, sent: 0, failed: 0 });
    expect(firstSummary).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(delivered).toBe(true);
    expect(timers.intervalMs).toBe(25);
    expect(timers.clears).toBe(1);
  });

  it("retries an indeterminate renewal error and keeps the pending send exclusively owned", async () => {
    const first = openRepository();
    first.repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const secondDatabase = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const secondRepository = new ReminderRepository(secondDatabase);
    const timers = new ManualHeartbeatTimers();
    const renewClaim = first.repository.renewClaim.bind(first.repository);
    let renewalAttempts = 0;
    vi.spyOn(first.repository, "renewClaim").mockImplementation((...args) => {
      renewalAttempts += 1;
      if (renewalAttempts === 1) throw new Error("SQLITE_BUSY: transient test lock");
      return renewClaim(...args);
    });
    let currentMs = mondayAtNine.getTime();
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    let sends = 0;
    const channel: NotificationChannel = {
      send: async () => {
        sends += 1;
        if (sends === 1) {
          firstStarted();
          await release;
          return { status: "failure", category: "timeout" };
        }
        return { status: "success" };
      }
    };

    const firstRun = runDueReminders(mondayAtNine, {
      repository: first.repository,
      channel,
      claimToken: () => "first-token",
      claimLeaseMs: 100,
      heartbeatIntervalMs: 25,
      clock: () => new Date(currentMs),
      timers
    });
    await started;
    currentMs += 50;
    timers.fire();
    currentMs += 25;
    timers.fire();
    currentMs += 50;
    const secondSummary = await runDueReminders(new Date(currentMs), {
      repository: secondRepository,
      channel,
      claimToken: () => "second-token",
      claimLeaseMs: 100,
      heartbeatIntervalMs: 25,
      clock: () => new Date(currentMs),
      timers: new ManualHeartbeatTimers()
    });
    releaseFirst();
    const firstSummary = await firstRun;
    const reminder = first.repository.get("outbound-checkin", new Date(currentMs));
    const delivered = first.repository.wasDelivered("outbound-checkin", "2026-08-24");
    first.database.close();
    secondDatabase.close();

    expect(renewalAttempts).toBe(2);
    expect(sends).toBe(1);
    expect(secondSummary).toEqual({ checked: 1, sent: 0, failed: 0 });
    expect(firstSummary).toEqual({ checked: 1, sent: 0, failed: 1 });
    expect(delivered).toBe(false);
    expect(reminder.lastFailure).toMatchObject({ localDate: "2026-08-24", category: "timeout" });
    expect(timers.clears).toBe(1);
  });

  it("does not overlap reentrant heartbeat ticks", async () => {
    const { database, repository } = openRepository();
    repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const timers = new ManualHeartbeatTimers();
    const renewClaim = repository.renewClaim.bind(repository);
    let activeRenewals = 0;
    let maxActiveRenewals = 0;
    let renewalAttempts = 0;
    vi.spyOn(repository, "renewClaim").mockImplementation((...args) => {
      activeRenewals += 1;
      renewalAttempts += 1;
      maxActiveRenewals = Math.max(maxActiveRenewals, activeRenewals);
      if (renewalAttempts === 1) timers.fire();
      const renewed = renewClaim(...args);
      activeRenewals -= 1;
      return renewed;
    });
    let releaseSend!: () => void;
    const release = new Promise<void>((resolve) => { releaseSend = resolve; });
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => { sendStarted = resolve; });

    const run = runDueReminders(mondayAtNine, {
      repository,
      channel: { send: async () => { sendStarted(); await release; return { status: "success" }; } },
      claimToken: () => "owner-token",
      claimLeaseMs: 100,
      heartbeatIntervalMs: 25,
      clock: () => new Date(mondayAtNine.getTime() + 25),
      timers
    });
    await started;
    timers.fire();
    releaseSend();
    const summary = await run;
    database.close();

    expect(renewalAttempts).toBe(1);
    expect(maxActiveRenewals).toBe(1);
    expect(summary).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(timers.clears).toBe(1);
  });

  it("reports failure and stops heartbeat when a pending sender loses token ownership", async () => {
    const first = openRepository();
    first.repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const secondDatabase = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    const secondRepository = new ReminderRepository(secondDatabase);
    const timers = new ManualHeartbeatTimers();
    let currentMs = mondayAtNine.getTime();
    let releaseSend!: () => void;
    const release = new Promise<void>((resolve) => { releaseSend = resolve; });
    const channel: NotificationChannel = { send: async () => { await release; return { status: "success" }; } };

    const run = runDueReminders(mondayAtNine, {
      repository: first.repository,
      channel,
      claimToken: () => "stale-token",
      claimLeaseMs: 100,
      heartbeatIntervalMs: 25,
      clock: () => new Date(currentMs),
      timers
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    currentMs += 101;
    expect(secondRepository.acquireDeliveryClaim(
      "outbound-checkin", "2026-08-24", "new-owner",
      new Date(currentMs), new Date(currentMs + 100)
    )).toBe(true);
    timers.fire();
    releaseSend();
    const summary = await run;

    expect(summary).toEqual({ checked: 1, sent: 0, failed: 1 });
    expect(first.repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(false);
    expect(first.repository.completeDeliveryFailure(
      "outbound-checkin", "2026-08-24", "new-owner", "timeout", new Date(currentMs)
    )).toBe(true);
    expect(timers.clears).toBe(1);
    first.database.close();
    secondDatabase.close();
  });

  it("stops heartbeat after a delivery failure so no timer remains active", async () => {
    const { database, repository } = openRepository();
    repository.save("outbound-checkin", {
      enabled: true,
      localTime: "09:00",
      recipient: "me@example.com",
      subject: "提交外勤打卡提醒",
      body: "请提交本周外勤打卡。"
    }, mondayAtNine);
    const timers = new ManualHeartbeatTimers();

    const summary = await runDueReminders(mondayAtNine, {
      repository,
      channel: new RecordingChannel({ status: "failure", category: "timeout" }),
      claimToken: () => "failure-token",
      claimLeaseMs: 100,
      heartbeatIntervalMs: 25,
      clock: () => mondayAtNine,
      timers
    });

    expect(summary).toEqual({ checked: 1, sent: 0, failed: 1 });
    expect(timers.clears).toBe(1);
    timers.fire();
    expect(timers.executions).toBe(0);
    expect(repository.acquireDeliveryClaim(
      "outbound-checkin", "2026-08-24", "retry-token", mondayAtNine, new Date(mondayAtNine.getTime() + 100)
    )).toBe(true);
    database.close();
  });

  it("allows only the claim owner to complete and makes owned failures retryable", () => {
    const { database, repository } = openRepository();
    try {
      const claimedAt = new Date("2026-08-24T01:00:00.000Z");
      const expiresAt = new Date("2026-08-24T01:05:00.000Z");
      expect(repository.acquireDeliveryClaim("outbound-checkin", "2026-08-24", "owner-token", claimedAt, expiresAt)).toBe(true);

      expect(repository.completeDeliverySuccess("outbound-checkin", "2026-08-24", "stale-token", mondayAtNine)).toBe(false);
      expect(repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(false);
      expect(repository.completeDeliveryFailure("outbound-checkin", "2026-08-24", "stale-token", "timeout", mondayAtNine)).toBe(false);
      expect(repository.acquireDeliveryClaim("outbound-checkin", "2026-08-24", "blocked-token", claimedAt, expiresAt)).toBe(false);

      expect(repository.completeDeliveryFailure("outbound-checkin", "2026-08-24", "owner-token", "timeout", mondayAtNine)).toBe(true);
      expect(repository.acquireDeliveryClaim("outbound-checkin", "2026-08-24", "retry-token", claimedAt, expiresAt)).toBe(true);
      expect(repository.completeDeliverySuccess("outbound-checkin", "2026-08-24", "retry-token", mondayAtNine)).toBe(true);
      expect(repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(true);
    } finally {
      database.close();
    }
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
    const fakeNode = process.execPath;
    const fakeEntry = join(controlledRoot, "apps", "server", "dist", "reminder-entry.cjs");
    const synchronizationMarker = join(tempDir, "whatif-synchronization.txt");
    await mkdir(join(controlledRoot, "runtime"), { recursive: true });
    await mkdir(join(controlledRoot, "apps", "server", "dist"), { recursive: true });
    await writeFile(fakeEntry, `require("node:fs").writeFileSync(process.env.LYJ_SYNC_MARKER, process.argv.slice(2).join("|"));`);
    const script = resolve(process.cwd(), "../../scripts/install-reminder-task.ps1");
    const environment = { ...process.env, LYJ_SYNC_MARKER: synchronizationMarker };

    const { stdout, stderr } = await execFileAsync("powershell", [
      "-NoProfile", "-File", script, "-WhatIf", "-ProjectRoot", controlledRoot,
      "-NodePath", fakeNode, "-ReminderEntryPath", fakeEntry, "-LocalTime", "10:15"
    ], { env: environment });

    expect(stderr).toBe("");
    expect(stdout.match(/LYJWorkBench-OutboundCheckin/g)).toHaveLength(1);
    expect(stdout).toContain("Monday 10:15");
    expect(stdout).toContain(fakeNode);
    expect(stdout).toContain(fakeEntry);
    await expect(readFile(synchronizationMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const defaultRoot = await execFileAsync("powershell", [
      "-NoProfile", "-File", script, "-WhatIf", "-NodePath", fakeNode,
      "-ReminderEntryPath", fakeEntry, "-LocalTime", "10:15"
    ], { env: environment });
    expect(defaultRoot.stderr).toBe("");
    expect(defaultRoot.stdout).toContain(resolve(process.cwd(), "../.."));
  });

  it("marks scheduler synchronization only after a controlled successful registration", async () => {
    const controlledRoot = join(tempDir, "managed install");
    const fakeEntry = join(controlledRoot, "apps", "server", "dist", "reminder-entry.cjs");
    const registrationMarker = join(tempDir, "registration.txt");
    const synchronizationMarker = join(tempDir, "synchronization.txt");
    const wrapper = join(tempDir, "managed-install.ps1");
    const installer = resolve(process.cwd(), "../../scripts/install-reminder-task.ps1");
    await mkdir(join(controlledRoot, "apps", "server", "dist"), { recursive: true });
    await writeFile(fakeEntry, `
      const fs = require("node:fs");
      if (!fs.existsSync(process.env.LYJ_REGISTRATION_MARKER)) process.exit(7);
      fs.writeFileSync(process.env.LYJ_SYNC_MARKER, process.argv.slice(2).join("|"));
    `);
    await writeFile(wrapper, `
      param([string]$Installer, [string]$ProjectRoot, [string]$NodePath, [string]$EntryPath)
      function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) return [pscustomobject]@{} }
      function New-ScheduledTaskTrigger { param([switch]$Weekly, $WeeksInterval, $DaysOfWeek, $At) return [pscustomobject]@{} }
      function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel) return [pscustomobject]@{} }
      function Register-ScheduledTask {
        param($TaskName, $TaskPath, $Action, $Trigger, $Principal, $Description, [switch]$Force)
        Set-Content -LiteralPath $env:LYJ_REGISTRATION_MARKER -Value ($TaskPath + '|' + $TaskName)
      }
      & $Installer -ProjectRoot $ProjectRoot -NodePath $NodePath -ReminderEntryPath $EntryPath -LocalTime '10:15' -Confirm:$false
    `);

    const { stderr } = await execFileAsync("powershell", [
      "-NoProfile", "-File", wrapper,
      "-Installer", installer,
      "-ProjectRoot", controlledRoot,
      "-NodePath", process.execPath,
      "-EntryPath", fakeEntry
    ], { env: { ...process.env, LYJ_REGISTRATION_MARKER: registrationMarker, LYJ_SYNC_MARKER: synchronizationMarker } });

    expect(stderr).toBe("");
    expect((await readFile(registrationMarker, "utf8")).trim()).toBe("\\|LYJWorkBench-OutboundCheckin");
    expect(await readFile(synchronizationMarker, "utf8")).toBe(
      "--reminder|outbound-checkin|--scheduler-synchronized-time|10:15"
    );
  });

  it("queries and unregisters only the exact root task identity in a controlled PowerShell session", async () => {
    const uninstaller = resolve(process.cwd(), "../../scripts/uninstall-reminder-task.ps1");
    const wrapper = join(tempDir, "controlled-uninstall.ps1");
    const queryMarker = join(tempDir, "query.txt");
    const removalMarker = join(tempDir, "removal.txt");
    await writeFile(wrapper, `
      param([string]$Uninstaller)
      function Get-ScheduledTask {
        param($TaskName, $TaskPath, $ErrorAction)
        Add-Content -LiteralPath $env:LYJ_QUERY_MARKER -Value ($TaskPath + '|' + $TaskName)
        return [pscustomobject]@{ TaskName = $TaskName; TaskPath = '\\' }
      }
      function Unregister-ScheduledTask {
        param($TaskName, $TaskPath, $Confirm)
        Add-Content -LiteralPath $env:LYJ_REMOVAL_MARKER -Value ($TaskPath + '|' + $TaskName)
      }
      & $Uninstaller -WhatIf -Confirm:$false
      if (Test-Path -LiteralPath $env:LYJ_REMOVAL_MARKER) { throw 'WhatIf performed a removal.' }
      & $Uninstaller -Confirm:$false
    `);

    const { stderr } = await execFileAsync("powershell", ["-NoProfile", "-File", wrapper, "-Uninstaller", uninstaller], {
      env: { ...process.env, LYJ_QUERY_MARKER: queryMarker, LYJ_REMOVAL_MARKER: removalMarker }
    });

    expect(stderr).toBe("");
    expect((await readFile(queryMarker, "utf8")).trim().split(/\r?\n/)).toEqual([
      "\\|LYJWorkBench-ReminderRunner", "\\|LYJWorkBench-OutboundCheckin"
    ]);
    expect((await readFile(removalMarker, "utf8")).trim().split(/\r?\n/)).toEqual([
      "\\|LYJWorkBench-ReminderRunner", "\\|LYJWorkBench-OutboundCheckin"
    ]);
  });

  it("refuses a same-name task returned from outside the exact root path", async () => {
    const uninstaller = resolve(process.cwd(), "../../scripts/uninstall-reminder-task.ps1");
    const wrapper = join(tempDir, "foreign-task-uninstall.ps1");
    const removalMarker = join(tempDir, "foreign-removal.txt");
    await writeFile(wrapper, `
      param([string]$Uninstaller)
      function Get-ScheduledTask {
        param($TaskName, $TaskPath, $ErrorAction)
        return [pscustomobject]@{ TaskName = $TaskName; TaskPath = '\\Foreign\\' }
      }
      function Unregister-ScheduledTask {
        param($TaskName, $TaskPath, $Confirm)
        Set-Content -LiteralPath $env:LYJ_REMOVAL_MARKER -Value 'removed'
      }
      & $Uninstaller -Confirm:$false
    `);

    await expect(execFileAsync("powershell", ["-NoProfile", "-File", wrapper, "-Uninstaller", uninstaller], {
      env: { ...process.env, LYJ_REMOVAL_MARKER: removalMarker }
    })).rejects.toMatchObject({ code: 1 });
    await expect(readFile(removalMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

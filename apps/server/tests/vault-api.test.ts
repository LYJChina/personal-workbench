import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import type { SecretStore } from "../src/platform/secret-store";
import { createVaultRouter } from "../src/modules/vault/vault.routes";
import { InvalidMasterPasswordError, type VaultService } from "../src/modules/vault/vault.service";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 };
const masterPassword = "correct horse battery staple";

describe("vault HTTP API", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function createTestApp(options: Parameters<typeof createApp>[0] = {}) {
    const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), "lyj-vault-api-"));
    if (!options.dataDir) temporaryDirectories.push(dataDir);
    return { dataDir, app: createApp({ ...options, dataDir, vaultScrypt: testScrypt }) };
  }

  it("sets up, reports, locks, and unlocks without exposing cryptographic fields", async () => {
    const { app } = await createTestApp();
    await request(app).get("/api/vault/status").expect(200, { configured: false, unlocked: false });

    const setup = await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    expect(setup.body).toEqual({ configured: true, unlocked: true });
    expect(JSON.stringify(setup.body)).not.toMatch(/password|salt|verifier|cipher|auth.?tag/i);

    await request(app).post("/api/vault/lock").expect(204);
    await request(app).get("/api/vault/status").expect(200, { configured: true, unlocked: false });
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(204);
    await request(app).get("/api/vault/status").expect(200, { configured: true, unlocked: true });
  });

  it("changes the master password and exposes only sanitized recovery status", async () => {
    const { app } = await createTestApp();
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(app).get("/api/vault/recovery/status").expect(200, {
      state: "disabled", maskedEmail: null, smtpHealth: "unknown", checkedAt: null
    });
    await request(app).put("/api/vault/password").send({
      currentPassword: masterPassword,
      newPassword: "replacement horse battery staple"
    }).expect(204);
    await request(app).post("/api/vault/lock").expect(204);
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(401);
    await request(app).post("/api/vault/unlock").send({ masterPassword: "replacement horse battery staple" }).expect(204);
  });

  it("enrolls email recovery without returning either plaintext code", async () => {
    const verify = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const { app } = await createTestApp({ vaultEnrollmentMailer: { verify, send } });
    const response = await request(app).post("/api/vault/enroll").send({
      masterPassword,
      recoveryEmail: "backup@example.com",
      mail: { smtpHost: "smtp.example.com", smtpPort: 465, transportMode: "tls", smtpUsername: "owner@example.com", fromAddress: "owner@example.com", smtpPassword: "smtp-code" }
    }).expect(201);
    expect(response.body).toEqual({ state: "pending", maskedEmail: "b***@example.com", smtpHealth: "unknown", checkedAt: null });
    expect(JSON.stringify(response.body)).not.toMatch(/recoveryCode|confirmationCode|smtp-code|LYJ-/i);
    expect(verify).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it.each(["short", "x".repeat(1025)])("rejects invalid setup passwords with one fixed response", async (candidate) => {
    const { app } = await createTestApp();
    await request(app).post("/api/vault/setup").send({ masterPassword: candidate }).expect(400, {
      error: { message: "主密码须为 12 至 1024 个字符", code: "VALIDATION_ERROR" }
    });
  });

  it("uses fixed sanitized responses for wrong passwords, unconfigured vaults, and integrity failures", async () => {
    const { app, dataDir } = await createTestApp();
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(409, {
      error: { message: "保险库尚未设置", code: "VAULT_NOT_CONFIGURED" }
    });
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(app).post("/api/vault/lock").expect(204);
    const wrong = await request(app).post("/api/vault/unlock").send({ masterPassword: "definitely-wrong-password" }).expect(401);
    expect(wrong.body).toEqual({ error: { message: "主密码不正确", code: "INVALID_MASTER_PASSWORD" } });
    expect(JSON.stringify(wrong.body)).not.toContain("definitely-wrong-password");

    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      database.pragma("ignore_check_constraints = ON");
      database.prepare("UPDATE vault_metadata SET verifier_tag = zeroblob(15) WHERE id = 1").run();
    } finally {
      database.close();
    }
    const integrity = await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(500);
    expect(integrity.body).toEqual({ error: { message: "保险库数据无法验证", code: "VAULT_INTEGRITY_ERROR" } });
    expect(JSON.stringify(integrity.body)).not.toMatch(/salt|verifier|cipher|auth.?tag/i);
  });

  it("starts a 30-second in-memory cooldown after five failures and clears it after app recreation", async () => {
    let monotonicMs = 0;
    const vaultMonotonicNow = () => monotonicMs;
    const { app, dataDir } = await createTestApp({ vaultMonotonicNow });
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(app).post("/api/vault/lock").expect(204);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post("/api/vault/unlock").send({ masterPassword: "definitely-wrong-password" }).expect(401);
    }
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(429, {
      error: { message: "尝试次数过多，请稍后再试", code: "TOO_MANY_ATTEMPTS" }
    });
    monotonicMs += 29_999;
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(429);
    monotonicMs += 1;
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(204);

    await request(app).post("/api/vault/lock").expect(204);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post("/api/vault/unlock").send({ masterPassword: "definitely-wrong-password" }).expect(401);
    }
    const recreated = createApp({ dataDir, vaultMonotonicNow, vaultScrypt: testScrypt });
    await request(recreated).get("/api/vault/status").expect(200, { configured: true, unlocked: false });
    await request(recreated).post("/api/vault/unlock").send({ masterPassword }).expect(204);
  });

  it("successful unlock resets consecutive failure counting", async () => {
    const { app } = await createTestApp();
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(app).post("/api/vault/lock").expect(204);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(app).post("/api/vault/unlock").send({ masterPassword: "definitely-wrong-password" }).expect(401);
    }
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(204);
    await request(app).post("/api/vault/lock").expect(204);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(app).post("/api/vault/unlock").send({ masterPassword: "definitely-wrong-password" }).expect(401);
    }
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(204);
  });

  it("serializes unlocks, starts cooldown when the fifth slow failure finishes, and skips excess KDF work", async () => {
    let monotonicMs = 0;
    let unlockCalls = 0;
    const fakeVault = {
      status: () => ({ configured: true, unlocked: false }),
      setup: async () => undefined,
      lock: () => undefined,
      unlock: async (candidate: string) => {
        unlockCalls += 1;
        if (candidate === masterPassword) return;
        if (unlockCalls === 5) monotonicMs = 5_000;
        throw new InvalidMasterPasswordError();
      }
    } satisfies Pick<VaultService, "status" | "setup" | "unlock" | "lock">;
    const app = express();
    app.use(express.json());
    app.use("/api", createVaultRouter({ vault: fakeVault, monotonicNow: () => monotonicMs }));

    const responses = await Promise.all(Array.from({ length: 10 }, () =>
      request(app).post("/api/vault/unlock").send({ masterPassword: "definitely-wrong-password" })
    ));
    expect(responses.filter(({ status }) => status === 401)).toHaveLength(5);
    expect(responses.filter(({ status }) => status === 429)).toHaveLength(5);
    expect(unlockCalls).toBe(5);

    monotonicMs = 34_999;
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(429);
    expect(unlockCalls).toBe(5);
    monotonicMs = 35_000;
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(204);
    expect(unlockCalls).toBe(6);
  });

  it("requires online SMTP verification before local SMTP recovery", async () => {
    const order: string[] = [];
    const fakeVault = {
      status: () => ({ configured: true, unlocked: false }), setup: async () => undefined, unlock: async () => undefined, lock: () => undefined,
      resetWithSmtp: async () => { order.push("reset"); }
    } satisfies Pick<VaultService, "status" | "setup" | "unlock" | "lock" | "resetWithSmtp">;
    const app = express(); app.use(express.json());
    app.use("/api", createVaultRouter({ vault: fakeVault, verifySmtpRecovery: async () => { order.push("verify"); } }));
    await request(app).post("/api/vault/recovery/smtp-reset").send({ smtpEmail: "owner@example.com", smtpPassword: "smtp-code", newPassword: "replacement-master-password" }).expect(204);
    expect(order).toEqual(["verify", "reset"]);
  });

  it("starts SMTP health verification without delaying a successful unlock", async () => {
    const onUnlocked = vi.fn(() => new Promise<void>(() => undefined));
    const fakeVault = { status: () => ({ configured: true, unlocked: false }), setup: async () => undefined, unlock: async () => undefined, lock: () => undefined } satisfies Pick<VaultService, "status" | "setup" | "unlock" | "lock">;
    const app = express(); app.use(express.json()); app.use("/api", createVaultRouter({ vault: fakeVault, onUnlocked }));
    await request(app).post("/api/vault/unlock").send({ masterPassword }).expect(204);
    expect(onUnlocked).toHaveBeenCalledOnce();
  });

  it("keeps a successful password reset when replacement recovery email fails", async () => {
    const afterRecoveryCodeReset = vi.fn(async () => { throw new Error("mail unavailable"); });
    const fakeVault = {
      status: () => ({ configured: true, unlocked: false }), setup: async () => undefined, unlock: async () => undefined, lock: () => undefined,
      resetWithRecoveryCode: async () => undefined
    } satisfies Pick<VaultService, "status" | "setup" | "unlock" | "lock" | "resetWithRecoveryCode">;
    const app = express(); app.use(express.json()); app.use("/api", createVaultRouter({ vault: fakeVault, afterRecoveryCodeReset }));
    await request(app).post("/api/vault/recovery/code-reset").send({ recoveryCode: "LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", newPassword: "replacement-master-password" }).expect(204);
    expect(afterRecoveryCodeReset).toHaveBeenCalledOnce();
  });

  it("serializes concurrent setup so the second request receives a fixed conflict", async () => {
    const { app } = await createTestApp();
    const responses = await Promise.all([
      request(app).post("/api/vault/setup").send({ masterPassword }),
      request(app).post("/api/vault/setup").send({ masterPassword: "another secure master password" })
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(responses.find(({ status }) => status === 409)?.body).toEqual({
      error: { message: "保险库已经设置", code: "VAULT_ALREADY_CONFIGURED" }
    });
  });

  it("uses the singleton vault as the default SecretStore but preserves explicit store injection", async () => {
    const defaultApp = (await createTestApp()).app;
    await request(defaultApp).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(defaultApp).put("/api/settings/deepseek").send({
      baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "sk-portable"
    }).expect(200);
    const settings = await request(defaultApp).get("/api/settings").expect(200);
    expect(settings.body.deepseek.apiKeyConfigured).toBe(true);
    await request(defaultApp).post("/api/vault/lock").expect(204);
    await request(defaultApp).get("/api/settings").expect(423, {
      error: { message: "保险库已锁定", code: "VAULT_LOCKED" }
    });

    const values = new Map<string, string>();
    const injectedStore: SecretStore = {
      protectSecret: async (name, plaintext) => { values.set(name, plaintext); },
      readSecret: async (name) => values.get(name) ?? null,
      deleteSecret: async (name) => { values.delete(name); }
    };
    const injectedApp = (await createTestApp({ secretStore: injectedStore })).app;
    await request(injectedApp).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(injectedApp).put("/api/settings/deepseek").send({
      baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "sk-injected"
    }).expect(200);
    expect(values.get("deepseek-api-key")).toBe("sk-injected");
  });

  it("does not retain an uncloseable SQLite handle after vault requests", async () => {
    const { app, dataDir } = await createTestApp();
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(app).post("/api/vault/lock").expect(204);
    await rm(dataDir, { recursive: true, force: true });
    await expect(rm(dataDir, { recursive: true, force: true })).resolves.toBeUndefined();
  });
});

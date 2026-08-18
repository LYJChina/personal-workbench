import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { ConnectionTestFailure, type MailConnectionInput, type ProviderConnectionInput } from "../src/modules/settings/settings.routes";
import type { SecretStore } from "../src/platform/dpapi";

class MemorySecretStore implements SecretStore {
  public readonly protectedValues: Array<{ name: string; plaintext: string }> = [];
  private readonly secrets = new Map<string, string>();

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    this.protectedValues.push({ name, plaintext });
    this.secrets.set(name, plaintext);
  }

  public async readSecret(name: string): Promise<string | null> {
    return this.secrets.get(name) ?? null;
  }
}

describe("secure settings API", () => {
  let tempDir: string;
  let secretStore: MemorySecretStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-settings-"));
    secretStore = new MemorySecretStore();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("stores DeepSeek non-secrets in SQLite and sends the key only to the secret store", async () => {
    const plaintext = "deepseek-secret-that-must-not-leak";
    const app = createApp({ dataDir: tempDir, secretStore });

    const saved = await request(app).put("/api/settings/deepseek").send({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: plaintext
    });
    const loaded = await request(app).get("/api/settings");
    const databaseBytes = await readFile(join(tempDir, "workbench.sqlite"));

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKeyConfigured: true });
    expect(secretStore.protectedValues).toEqual([{ name: "deepseek-api-key", plaintext }]);
    expect(JSON.stringify(saved.body)).not.toContain(plaintext);
    expect(JSON.stringify(loaded.body)).not.toContain(plaintext);
    expect(databaseBytes.includes(Buffer.from(plaintext))).toBe(false);
  });

  it("keeps existing secrets when replacement inputs are absent or empty", async () => {
    const app = createApp({ dataDir: tempDir, secretStore });
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "first-key" }).expect(200);
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com/v1", model: "deepseek-reasoner" }).expect(200);
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com/v1", model: "deepseek-reasoner", apiKey: "" }).expect(200);

    await request(app).put("/api/settings/mail").send({
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      transportMode: "starttls",
      smtpUsername: "user@example.com",
      fromAddress: "user@example.com",
      smtpPassword: "first-password"
    }).expect(200);
    await request(app).put("/api/settings/mail").send({
      smtpHost: "smtp2.example.com",
      smtpPort: 465,
      transportMode: "tls",
      smtpUsername: "user@example.com",
      fromAddress: "user@example.com",
      smtpPassword: "   "
    }).expect(200);

    expect(await secretStore.readSecret("deepseek-api-key")).toBe("first-key");
    expect(await secretStore.readSecret("smtp-password")).toBe("first-password");
    expect(secretStore.protectedValues).toHaveLength(2);
  });

  it("persists non-secret settings across app instances without exposing SMTP credentials", async () => {
    const plaintext = "smtp-secret-that-must-not-leak";
    const saved = await request(createApp({ dataDir: tempDir, secretStore })).put("/api/settings/mail").send({
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      transportMode: "tls",
      smtpUsername: "sender@example.com",
      fromAddress: "sender@example.com",
      smtpPassword: plaintext
    });
    const loaded = await request(createApp({ dataDir: tempDir, secretStore })).get("/api/settings");
    const databaseBytes = await readFile(join(tempDir, "workbench.sqlite"));

    expect(saved.body).toEqual({
      smtpHost: "smtp.example.com",
      smtpPort: 465,
      transportMode: "tls",
      smtpUsername: "sender@example.com",
      fromAddress: "sender@example.com",
      smtpPasswordConfigured: true
    });
    expect(loaded.body.mail).toEqual(saved.body);
    expect(JSON.stringify(loaded.body)).not.toContain(plaintext);
    expect(databaseBytes.includes(Buffer.from(plaintext))).toBe(false);
  });

  it("requires HTTPS DeepSeek URLs except for explicitly allowed loopback HTTP in tests", async () => {
    const rejected = await request(createApp({ dataDir: tempDir, secretStore })).put("/api/settings/deepseek").send({
      baseUrl: "http://example.com",
      model: "deepseek-chat"
    });
    const allowed = await request(createApp({ dataDir: tempDir, secretStore, allowLoopbackHttp: true })).put("/api/settings/deepseek").send({
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "deepseek-chat"
    });
    const nonLoopback = await request(createApp({ dataDir: tempDir, secretStore, allowLoopbackHttp: true })).put("/api/settings/deepseek").send({
      baseUrl: "http://192.168.1.20:8000/v1",
      model: "deepseek-chat"
    });

    expect(rejected.status).toBe(400);
    expect(allowed.status).toBe(200);
    expect(nonLoopback.status).toBe(400);
  });

  it.each([
    [{ smtpPort: 0, transportMode: "starttls" }, 400],
    [{ smtpPort: 65536, transportMode: "starttls" }, 400],
    [{ smtpPort: 587, transportMode: "plain" }, 400],
    [{ smtpPort: 1, transportMode: "starttls" }, 200],
    [{ smtpPort: 65535, transportMode: "tls" }, 200]
  ])("validates SMTP port and transport mode for %o", async (override, expectedStatus) => {
    const response = await request(createApp({ dataDir: tempDir, secretStore })).put("/api/settings/mail").send({
      smtpHost: "smtp.example.com",
      smtpUsername: "sender@example.com",
      fromAddress: "sender@example.com",
      ...override
    });
    expect(response.status).toBe(expectedStatus);
  });

  it.each([
    [undefined, { status: "success", message: "连接成功" }],
    [new ConnectionTestFailure("auth_failure"), { status: "auth_failure", message: "身份验证失败，请检查凭据" }],
    [new ConnectionTestFailure("timeout"), { status: "timeout", message: "连接超时，请稍后重试" }],
    [new ConnectionTestFailure("unreachable_host"), { status: "unreachable_host", message: "无法连接到服务器" }]
  ])("maps DeepSeek connection outcomes to sanitized responses", async (failure, expected) => {
    const tester = vi.fn(async (_input: ProviderConnectionInput) => {
      if (failure) throw failure;
    });
    const app = createApp({ dataDir: tempDir, secretStore, deepSeekConnectionTester: tester });
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "provider-credential" }).expect(200);

    const response = await request(app).post("/api/settings/deepseek/test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
    expect(JSON.stringify(response.body)).not.toMatch(/provider-credential|Bearer/i);
  });

  it.each([
    [undefined, { status: "success", message: "连接成功" }],
    [new ConnectionTestFailure("auth_failure"), { status: "auth_failure", message: "身份验证失败，请检查凭据" }],
    [new ConnectionTestFailure("timeout"), { status: "timeout", message: "连接超时，请稍后重试" }],
    [new ConnectionTestFailure("unreachable_host"), { status: "unreachable_host", message: "无法连接到服务器" }]
  ])("maps mail connection outcomes to sanitized responses", async (failure, expected) => {
    const tester = vi.fn(async (_input: MailConnectionInput) => {
      if (failure) throw failure;
    });
    const app = createApp({ dataDir: tempDir, secretStore, mailConnectionTester: tester });
    await request(app).put("/api/settings/mail").send({
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      transportMode: "starttls",
      smtpUsername: "sender@example.com",
      fromAddress: "sender@example.com",
      smtpPassword: "mail-credential"
    }).expect(200);

    const response = await request(app).post("/api/settings/mail/test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
    expect(JSON.stringify(response.body)).not.toContain("mail-credential");
  });
});

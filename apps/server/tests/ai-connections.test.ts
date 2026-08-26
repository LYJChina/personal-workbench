import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { AiGatewayError } from "../src/modules/ai-gateway/ai-gateway.types";
import { AiConnectionRepository } from "../src/modules/ai-gateway/ai-connection.repository";
import type { SecretStore } from "../src/platform/secret-store";

class MemorySecretStore implements SecretStore {
  public readonly secrets = new Map<string, string>();
  public readonly deleted: string[] = [];
  public deleteFailure: Error | null = null;
  public protectFailure: Error | null = null;

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    if (this.protectFailure) throw this.protectFailure;
    this.secrets.set(name, plaintext);
  }

  public async readSecret(name: string): Promise<string | null> {
    return this.secrets.get(name) ?? null;
  }

  public async deleteSecret(name: string): Promise<void> {
    if (this.deleteFailure) throw this.deleteFailure;
    this.deleted.push(name);
    this.secrets.delete(name);
  }
}

describe("AI connection management API", () => {
  let dataDir: string;
  let secretStore: MemorySecretStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "lyj-ai-connections-"));
    secretStore = new MemorySecretStore();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lists the migrated DeepSeek connection without exposing its secret name", async () => {
    await secretStore.protectSecret("deepseek-api-key", "legacy-secret");
    const response = await request(createApp({ dataDir, secretStore })).get("/api/settings/ai-connections");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id: "legacy-deepseek",
      name: "DeepSeek",
      protocol: "openai",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKeyConfigured: true,
      isDefault: true
    }]);
    expect(JSON.stringify(response.body)).not.toMatch(/legacy-secret|secretName|deepseek-api-key/);
  });

  it("creates, edits, switches, and deletes an Anthropic connection securely", async () => {
    const app = createApp({ dataDir, secretStore });
    const created = await request(app).post("/api/settings/ai-connections").send({
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
      apiKey: "anthropic-secret"
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "Claude",
      protocol: "anthropic",
      apiKeyConfigured: true,
      isDefault: false
    });
    expect(created.body.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(JSON.stringify(created.body)).not.toMatch(/anthropic-secret|secretName/);
    const id = String(created.body.id);
    const storedSecretName = [...secretStore.secrets.keys()].find((name) => name !== "deepseek-api-key");
    expect(storedSecretName).toBe(`ai-connection:${id}:api-key`);

    const updated = await request(app).put(`/api/settings/ai-connections/${id}`).send({
      name: "Claude Production",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-new-model"
    });
    expect(updated.body).toMatchObject({ name: "Claude Production", model: "claude-new-model", apiKeyConfigured: true });
    expect(secretStore.secrets.get(storedSecretName!)).toBe("anthropic-secret");

    await request(app).put(`/api/settings/ai-connections/${id}/default`).send({}).expect(200);
    const listed = await request(app).get("/api/settings/ai-connections").expect(200);
    expect(listed.body.find((entry: { id: string }) => entry.id === id).isDefault).toBe(true);
    expect(listed.body.find((entry: { id: string }) => entry.id === "legacy-deepseek").isDefault).toBe(false);

    await request(app).delete("/api/settings/ai-connections/legacy-deepseek").expect(204);
    expect(secretStore.deleted).toContain("deepseek-api-key");
    await request(app).delete(`/api/settings/ai-connections/${id}`).expect(409);
  });

  it("rejects invalid provider URLs and unknown input fields", async () => {
    const app = createApp({ dataDir, secretStore, allowLoopbackHttp: true });
    await request(app).post("/api/settings/ai-connections").send({
      name: "Remote HTTP",
      protocol: "openai",
      baseUrl: "http://192.168.1.20:8000/v1",
      model: "model"
    }).expect(400);
    await request(app).post("/api/settings/ai-connections").send({
      name: "Injected",
      protocol: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "model",
      secretName: "chosen-by-client"
    }).expect(400);
  });

  it("requires an explicit default switch before deleting the current default connection", async () => {
    const app = createApp({ dataDir, secretStore });
    await request(app).post("/api/settings/ai-connections").send({
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model"
    }).expect(201);

    const response = await request(app).delete("/api/settings/ai-connections/legacy-deepseek");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { message: "Switch the default AI connection before deleting it", code: "AI_CONNECTION_IS_DEFAULT" }
    });
    expect((await request(app).get("/api/settings/ai-connections")).body).toHaveLength(2);
  });

  it("keeps connection metadata when encrypted secret deletion fails", async () => {
    const app = createApp({ dataDir, secretStore });
    const created = await request(app).post("/api/settings/ai-connections").send({
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
      apiKey: "retained-secret"
    }).expect(201);
    secretStore.deleteFailure = new Error("secret-bearing delete failure");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(app).delete(`/api/settings/ai-connections/${created.body.id}`);

    expect(response.status).toBe(500);
    const listed = await request(app).get("/api/settings/ai-connections").expect(200);
    expect(listed.body.some((entry: { id: string }) => entry.id === created.body.id)).toBe(true);
    expect([...secretStore.secrets.values()]).toContain("retained-secret");
    expect(JSON.stringify(response.body)).not.toContain("secret-bearing");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-bearing");
  });

  it("restores the encrypted secret when metadata deletion fails after preflight", async () => {
    const app = createApp({ dataDir, secretStore });
    const created = await request(app).post("/api/settings/ai-connections").send({
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
      apiKey: "compensated-secret"
    }).expect(201);
    vi.spyOn(AiConnectionRepository.prototype, "delete").mockImplementationOnce(() => {
      throw new Error("injected metadata failure");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await request(app).delete(`/api/settings/ai-connections/${created.body.id}`).expect(500);

    expect([...secretStore.secrets.values()]).toContain("compensated-secret");
    const listed = await request(app).get("/api/settings/ai-connections").expect(200);
    expect(listed.body.some((entry: { id: string }) => entry.id === created.body.id)).toBe(true);
  });

  it("removes newly-created metadata when storing its encrypted secret fails", async () => {
    const app = createApp({ dataDir, secretStore });
    secretStore.protectFailure = new Error("injected protect failure");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await request(app).post("/api/settings/ai-connections").send({
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
      apiKey: "failed-secret"
    }).expect(500);

    const listed = await request(app).get("/api/settings/ai-connections").expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe("legacy-deepseek");
  });

  it("restores the previous encrypted secret when metadata update fails", async () => {
    const app = createApp({ dataDir, secretStore });
    const created = await request(app).post("/api/settings/ai-connections").send({
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
      apiKey: "original-secret"
    }).expect(201);
    vi.spyOn(AiConnectionRepository.prototype, "update").mockImplementationOnce(() => {
      throw new Error("injected update failure");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await request(app).put(`/api/settings/ai-connections/${created.body.id}`).send({
      name: "Claude Updated",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-new",
      apiKey: "replacement-secret"
    }).expect(500);

    expect([...secretStore.secrets.values()]).toContain("original-secret");
    expect([...secretStore.secrets.values()]).not.toContain("replacement-secret");
  });

  it.each([
    [undefined, { status: "success", message: "连接成功" }],
    [new AiGatewayError("auth"), { status: "auth_failure", message: "身份验证失败，请检查凭据" }],
    [new AiGatewayError("billing"), { status: "billing_failure", message: "服务商账户余额不足或计费不可用" }],
    [new AiGatewayError("invalid_request"), { status: "invalid_request", message: "服务商拒绝了请求，请检查模型名称和 API 地址" }],
    [new AiGatewayError("rate_limit"), { status: "rate_limit", message: "请求过于频繁或额度已受限，请稍后重试" }],
    [new AiGatewayError("timeout"), { status: "timeout", message: "连接超时，请稍后重试" }],
    [new AiGatewayError("network"), { status: "unreachable_host", message: "无法连接到服务商服务器，请检查网络和 API 地址" }],
    [new AiGatewayError("upstream"), { status: "provider_error", message: "服务商暂时异常，请稍后重试" }]
  ])("tests one selected connection with sanitized results", async (failure, expected) => {
    await secretStore.protectSecret("deepseek-api-key", "provider-secret");
    const tester = vi.fn(async () => { if (failure) throw failure; });
    const app = createApp({ dataDir, secretStore, aiConnectionTester: tester });

    const response = await request(app).post("/api/settings/ai-connections/legacy-deepseek/test");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expected);
    expect(tester).toHaveBeenCalledWith("legacy-deepseek", expect.any(AbortSignal));
    expect(JSON.stringify(response.body)).not.toMatch(/provider-secret|Bearer/i);
  });
});

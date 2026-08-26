import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { openDatabase } from "../src/db/database";
import { resolveAppPaths } from "../src/config/paths";
import { AiChatRepository } from "../src/modules/ai-chat/ai-chat.repository";
import { AiGatewayError, type AiCompletionInput } from "../src/modules/ai-gateway/ai-gateway.types";
import type { SecretStore } from "../src/platform/secret-store";
import { createApp } from "../src/app";

class MemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();
  public async protectSecret(name: string, plaintext: string) { this.secrets.set(name, plaintext); }
  public async readSecret(name: string) { return this.secrets.get(name) ?? null; }
  public async deleteSecret(name: string) { this.secrets.delete(name); }
}

class StubChatGenerator {
  public readonly inputs: AiCompletionInput[] = [];
  public fail = false;

  public async complete(input: AiCompletionInput) {
    this.inputs.push(input);
    if (this.fail) throw new AiGatewayError("upstream");
    return { content: `回答：${input.messages.at(-1)?.content}`, model: "deepseek-chat-actual" };
  }
}

describe("AI chat repository", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "lyj-workbench-ai-chat-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("stores a chronological local conversation and clears it", () => {
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const repository = new AiChatRepository(database);

    const user = repository.create("user", "今天上海天气如何？", null);
    const assistant = repository.create("assistant", "我无法直接查看实时天气。", "deepseek-chat");

    expect(repository.list()).toEqual([user, assistant]);
    expect(user).toMatchObject({ id: 1, role: "user", content: "今天上海天气如何？", model: null });
    expect(assistant).toMatchObject({ id: 2, role: "assistant", model: "deepseek-chat" });

    repository.clear();
    expect(repository.list()).toEqual([]);
    database.close();
  });
});

describe("AI chat API", () => {
  let dataDir: string;
  let secretStore: MemorySecretStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "lyj-workbench-ai-chat-api-"));
    secretStore = new MemorySecretStore();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("sends prior local messages as bounded conversation context", async () => {
    const generator = new StubChatGenerator();
    const app = createApp({ dataDir, secretStore, aiGateway: generator });
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "test-key" }).expect(200);

    await request(app).post("/api/ai-chat/messages").send({ content: "第一个问题" }).expect(201);
    const second = await request(app).post("/api/ai-chat/messages").send({ content: "继续说明" }).expect(201);

    expect(second.body).toMatchObject({ role: "assistant", content: "回答：继续说明", model: "deepseek-chat-actual" });
    expect(generator.inputs[1].messages.slice(1).map((message) => [message.role, message.content])).toEqual([
      ["user", "第一个问题"],
      ["assistant", "回答：第一个问题"],
      ["user", "继续说明"]
    ]);
    await request(app).get("/api/ai-chat/messages").expect(200).expect((response) => expect(response.body).toHaveLength(4));
  });

  it("returns a clear configuration error without exposing secrets", async () => {
    const response = await request(createApp({ dataDir, secretStore }))
      .post("/api/ai-chat/messages")
      .send({ content: "你好" })
      .expect(409);

    expect(response.body).toEqual({ error: { message: "请先在设置中配置模型服务", code: "AI_NOT_CONFIGURED" } });
    expect(JSON.stringify(response.body)).not.toContain("apiKey");
  });

  it("preserves the user message when the model request fails", async () => {
    const generator = new StubChatGenerator();
    generator.fail = true;
    const app = createApp({ dataDir, secretStore, aiGateway: generator });
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "test-key" }).expect(200);

    await request(app).post("/api/ai-chat/messages").send({ content: "保留这个问题" }).expect(502);
    await request(app).get("/api/ai-chat/messages").expect(200).expect((response) => {
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({ role: "user", content: "保留这个问题" });
    });
  });

  it("clears the local conversation", async () => {
    const generator = new StubChatGenerator();
    const app = createApp({ dataDir, secretStore, aiGateway: generator });
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "test-key" }).expect(200);
    await request(app).post("/api/ai-chat/messages").send({ content: "临时问题" }).expect(201);

    await request(app).delete("/api/ai-chat/messages").expect(204);
    await request(app).get("/api/ai-chat/messages").expect(200).expect([]);
  });

  it("keeps only bounded recent context and never starts it with an assistant message", async () => {
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const repository = new AiChatRepository(database);
    for (let index = 0; index < 24; index += 1) {
      repository.create(index % 2 === 0 ? "user" : "assistant", `历史消息 ${index + 1}`, index % 2 === 0 ? null : "deepseek-chat");
    }
    database.close();
    const generator = new StubChatGenerator();
    const app = createApp({ dataDir, secretStore, aiGateway: generator });
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "test-key" }).expect(200);

    await request(app).post("/api/ai-chat/messages").send({ content: "最新问题" }).expect(201);

    expect(generator.inputs[0].messages.length).toBeLessThanOrEqual(21);
    expect(generator.inputs[0].messages[0].role).toBe("system");
    expect(generator.inputs[0].messages[1].role).toBe("user");
    expect(generator.inputs[0].messages.at(-1)).toEqual({ role: "user", content: "最新问题" });
  });
});

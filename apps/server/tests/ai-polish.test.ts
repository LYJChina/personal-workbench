import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { buildAiPolishMessages } from "../src/modules/ai-polish/ai-polish.prompt";
import type { AiPolishGenerationInput, AiPolishGenerator } from "../src/modules/ai-polish/ai-polish.client";
import type { SecretStore } from "../src/platform/dpapi";
import { openDatabase } from "../src/db/database";
import { resolveAppPaths } from "../src/config/paths";

class MemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();
  public async protectSecret(name: string, plaintext: string) { this.secrets.set(name, plaintext); }
  public async readSecret(name: string) { return this.secrets.get(name) ?? null; }
}

class StubPolishGenerator implements AiPolishGenerator {
  public readonly inputs: AiPolishGenerationInput[] = [];
  public async generatePolish(input: AiPolishGenerationInput) {
    this.inputs.push(input);
    return { content: `已处理：${input.primaryText}`, model: "deepseek-chat-actual" };
  }
}

describe("AI polish prompts", () => {
  it("keeps the fixed fact-safety boundary before the visible editable prompt", () => {
    const messages = buildAiPolishMessages({ kind: "leadership", primaryText: "项目完成", secondaryText: "请确认方案", systemPrompt: "采用简洁语气" });
    expect(messages.map((message) => message.role)).toEqual(["system", "system", "user"]);
    expect(messages[0].content).toMatch(/不得编造/);
    expect(messages[1].content).toBe("采用简洁语气");
    expect(messages[2].content).toContain("沟通素材\n项目完成");
    expect(messages[2].content).toContain("希望领导关注\n请确认方案");
  });
});

describe("AI polish API", () => {
  let dataDir: string;
  let secretStore: MemorySecretStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "lyj-workbench-ai-polish-"));
    secretStore = new MemorySecretStore();
  });
  afterEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

  it("persists each scenario and returns a single newest-first history", async () => {
    const generator = new StubPolishGenerator();
    const app = createApp({ dataDir, secretStore, aiPolishClient: generator });
    await request(app).put("/api/settings/deepseek").send({ baseUrl: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "test-key" }).expect(200);

    const daily = await request(app).post("/api/ai-polish/generate").send({ kind: "daily_report", primaryText: "完成测试", secondaryText: "", systemPrompt: "日报提示词" }).expect(201);
    const leadership = await request(app).post("/api/ai-polish/generate").send({ kind: "leadership", primaryText: "项目完成", secondaryText: "请确认", systemPrompt: "领导提示词" }).expect(201);
    const history = await request(app).get("/api/ai-polish").expect(200);

    expect(history.body.map((record: { kind: string }) => record.kind)).toEqual(["leadership", "daily_report"]);
    expect(leadership.body).toMatchObject({ kind: "leadership", primaryText: "项目完成", secondaryText: "请确认", systemPrompt: "领导提示词", content: "已处理：项目完成" });
    expect(generator.inputs[1]).toMatchObject({ kind: "leadership", apiKey: "test-key" });
    await request(app).put(`/api/ai-polish/${daily.body.id}`).send({ content: "修改后的日报" }).expect(200).expect((response) => expect(response.body.content).toBe("修改后的日报"));
  });

  it("rejects invalid kinds and empty source content before calling DeepSeek", async () => {
    const generator = new StubPolishGenerator();
    const app = createApp({ dataDir, secretStore, aiPolishClient: generator });
    await request(app).post("/api/ai-polish/generate").send({ kind: "unknown", primaryText: "内容", secondaryText: "", systemPrompt: "提示词" }).expect(400);
    await request(app).post("/api/ai-polish/generate").send({ kind: "general", primaryText: "", secondaryText: "", systemPrompt: "提示词" }).expect(400);
    expect(generator.inputs).toEqual([]);
  });

  it("upgrades an early AI history table and imports existing daily reports exactly once", () => {
    const databasePath = join(dataDir, "workbench.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE daily_reports (id INTEGER PRIMARY KEY, completed TEXT NOT NULL, risks TEXT NOT NULL, content TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO daily_reports VALUES (7, '完成旧日报', '', '旧日报正文', 'deepseek-chat', '2026-08-18T08:00:00.000Z', '2026-08-18T08:00:00.000Z');
      CREATE TABLE ai_polish_records (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, primary_text TEXT NOT NULL, secondary_text TEXT NOT NULL, system_prompt TEXT NOT NULL, content TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    legacy.close();

    for (let run = 0; run < 2; run += 1) openDatabase(resolveAppPaths({ dataDir })).close();
    const migrated = new Database(databasePath, { readonly: true });
    const rows = migrated.prepare("SELECT legacy_daily_report_id, kind, content FROM ai_polish_records").all();
    migrated.close();

    expect(rows).toEqual([{ legacy_daily_report_id: 7, kind: "daily_report", content: "旧日报正文" }]);
  });
});
